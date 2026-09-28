# Push notifications

Runs on: your browser (the Apple Developer account), your Mac (the app and
EAS), and your box (the API sends the pushes).

A push notification reaches the user when the app is closed: "your import is
ready", "someone replied", "your plan renews tomorrow". This guide sets up the
Apple key, asks for permission at the right moment, stores each device's token
on your server, and sends from your API through the Expo Push Service. You
need it only when the app has a real reason to reach a user who is not looking
at it. A reminder the user asked for is a good reason. "Come back to the app"
is not.

## What it costs

| Item | Cost | Notes |
|---|---|---|
| Apple Push Notification service (APNs) | included | Part of the Apple Developer Program. |
| Expo Push Service | free | Expo charges nothing for it. Limit: 600 notifications per second per project, up to 100 messages per request. |
| Sending from the box | nothing extra | One HTTPS call per 100 messages. |

Checked 2026-09-28 at https://docs.expo.dev/push-notifications/faq/ and
https://docs.expo.dev/push-notifications/sending-notifications/.

## How it fits together

```
app  ── permission, then the Expo push token ──>  your API  ──>  Postgres (push_tokens)

your API ── POST https://exp.host/--/api/v2/push/send ──>  Expo  ──>  APNs  ──>  iPhone
         <── a ticket per message (an id, or an error)

your API ── 15 minutes later: POST .../push/getReceipts ──>  delete dead tokens
```

Two tokens exist. Do not mix them up:

- The **Expo push token** looks like `ExponentPushToken[xxxxxxxx]`. You get it
  with `getExpoPushTokenAsync`. You send it to the Expo Push Service. This
  guide uses it.
- The **native APNs device token** is a long hex string. You get it with
  `getDevicePushTokenAsync`. You need it only if your server talks to APNs
  directly (see "Send to APNs directly" below).

## Steps

### 1. The APNs key

APNs accepts pushes only from a server that holds your team's APNs key (a
`.p8` file). Expo's servers use it for you. Pick one way:

- **Let EAS make it.** On the first build after you add `expo-notifications`,
  EAS asks "Setup Push Notifications for your project?" and then offers to
  generate a new Apple Push Notifications service key. Answer yes to both. Or
  run `eas credentials`, pick iOS, then **Push Notifications: Manage your Apple
  Push Notifications Key**.
- **Make it yourself**, then upload it with `eas credentials`. In the Apple
  Developer account: **Certificates, Identifiers & Profiles**, **Keys**, **+**.
  Tick **Apple Push Notification service (APNs)**, click **Configure**, and
  choose the environment **Sandbox & Production** and the type **Team
  Scoped**. Download the `.p8` file. Apple lets you download it once only.
  Note the 10-character Key ID. You need the Account Holder or Admin role.

Why **Sandbox & Production**: development builds (and the Simulator) use the
APNs sandbox. TestFlight and App Store builds use production. A key for one
environment only does not work for the other.

One team-scoped key works for every app in your team. Apple allows at most two
team-scoped keys per environment, so reuse the key for your next app. Keep the
`.p8` file in your secrets tool ([secrets.md](secrets.md)).

The App ID also needs the Push Notifications capability. EAS turns it on for
you on `eas build`: it syncs the capabilities with the entitlements that the
`expo-notifications` plugin adds.

### 2. Add expo-notifications to the app

```bash
npx expo install expo-notifications expo-constants
```

`app.json`:

```json
{ "expo": { "plugins": ["expo-notifications"] } }
```

This is a native change. Make a new development build. Expo Go does not
support push notifications from SDK 53 on.

### 3. One notification handler, at the root

The handler decides what happens when a push arrives **while the app is open**.

```tsx
// app/_layout.tsx, at module level, outside any component
import * as Notifications from "expo-notifications";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});
```

The trap: **there is only one handler.** Each call to
`setNotificationHandler` removes the one before. If a feature screen or a
library calls it again, your root handler is gone, and nothing warns you.
Call it once, in `app/_layout.tsx`. Search the code for a second call:
`git grep -n setNotificationHandler`.

Three more facts:

- On SDK 57 and earlier, a push that arrives while the app is open is **not
  shown at all** unless a handler asks for it. From SDK 58 it is shown by
  default. Set the handler anyway, so the behaviour does not depend on the SDK.
- The handler must answer within 3 seconds. Do not call your API inside it.
- `shouldShowAlert` is deprecated. Use `shouldShowBanner` and `shouldShowList`.

### 4. Ask for permission at the right moment

iOS shows the system prompt **once**. If the user taps "Don't Allow", the app
can never show it again. Only the Settings app can change the answer. So do not
ask at the first launch. Ask when the user does something that needs a push:
turns on reminders, or starts an import that takes minutes.

Show your own short screen first: what you will send, and how often. Then call
the system prompt.

```ts
// src/push.ts
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Linking } from "react-native";
import { api } from "./api";   // your API client, with the user's token

export async function enablePush(): Promise<boolean> {
  let perm = await Notifications.getPermissionsAsync();
  if (perm.status !== "granted" && perm.canAskAgain) {
    perm = await Notifications.requestPermissionsAsync();
  }
  if (perm.status !== "granted") {
    if (!perm.canAskAgain) await Linking.openSettings();   // only after the user tapped "turn on"
    return false;                                          // the app keeps working without push
  }
  await registerPushToken();
  return true;
}

export async function registerPushToken() {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api.post("/push-tokens", { token });
}
```

- Call `registerPushToken()` again on each app start when the user is signed
  in and permission is `granted`. It is a cheap upsert, and it keeps the
  server right when a token changes.
- Getting the token can take a long time on iOS, for example without network.
  Do not block a screen on it.
- iOS also offers **provisional** permission
  (`requestPermissionsAsync({ ios: { allowProvisional: true } })`). Pushes then
  arrive quietly in Notification Center, with no prompt first.

### 5. Store the token per user and device

One row per device. The token is the key, so a device that signs in as another
user moves to that user.

```sql
create table push_tokens (
  token      text        primary key,   -- ExponentPushToken[...]
  user_id    text        not null,
  updated_at timestamptz not null default now()
);
create index push_tokens_user on push_tokens (user_id);

create table push_tickets (               -- sent messages whose receipt we still need to read
  id      text        primary key,
  token   text        not null,
  sent_at timestamptz not null default now()
);
```

The API needs three things:

- `POST /push-tokens` (signed in): check the format first. It starts with
  `ExponentPushToken[` or `ExpoPushToken[` and ends with `]`. In Node,
  `Expo.isExpoPushToken(token)` does this check. Then
  `insert into push_tokens (token, user_id) values (@token, @me) on conflict (token) do update set user_id = excluded.user_id, updated_at = now()`.
  Take `@me` from the access token, never from the body.
- `DELETE /push-tokens/{token}` on sign-out, only for a row the user owns.
  Otherwise the next person on that phone gets the last user's pushes.
- On account deletion, delete all of the user's rows.

This table breaks two rules from [backend.md](backend.md) on purpose: the
upsert moves a row to another owner, and the sender reads across users. Do the
upsert in raw SQL, not through the tracked `OwnerId` entity, and mark the
sender's query as an `IgnoreQueryFilters()` review point.

### 6. Send from the API

Send from a background job, not inside a user's request. The skill
`app-features:durable-jobs` has the job pattern and already sends a push when a
job is done.

**Node**, with Expo's own SDK (`npm install expo-server-sdk`). It batches,
throttles, retries and compresses for you:

```js
import { Expo } from "expo-server-sdk";
const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

export async function sendToUser(pool, userId, title, body, data = {}) {
  const { rows } = await pool.query("select token from push_tokens where user_id = $1", [userId]);
  const messages = rows.map((r) => ({ to: r.token, title, body, data }));
  for (const chunk of expo.chunkPushNotifications(messages)) {
    const tickets = await expo.sendPushNotificationsAsync(chunk);
    for (const [i, t] of tickets.entries()) {
      if (t.status === "ok") await pool.query("insert into push_tickets (id, token) values ($1, $2)", [t.id, chunk[i].to]);
      else if (t.details?.error === "DeviceNotRegistered") await pool.query("delete from push_tokens where token = $1", [chunk[i].to]);
    }
  }
}
```

**.NET**: Expo has no official .NET SDK. The HTTP API is small:

```csharp
using System.Text.Json.Serialization;

public sealed record PushMessage(string To, string Title, string Body,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] object? Data = null);
public sealed record PushResult(string Status, string? Id, string? Message, PushDetails? Details);
public sealed record PushDetails(string? Error);
sealed record Tickets(List<PushResult> Data);
sealed record Receipts(Dictionary<string, PushResult> Data);

// Register with: builder.Services.AddHttpClient<ExpoPush>(c => {
//   c.BaseAddress = new Uri("https://exp.host/");
//   c.DefaultRequestHeaders.Authorization = new("Bearer", builder.Configuration["EXPO_ACCESS_TOKEN"]); });
public sealed class ExpoPush(HttpClient http)
{
    public async Task<List<(PushMessage Msg, PushResult Ticket)>> SendAsync(IEnumerable<PushMessage> messages, CancellationToken ct)
    {
        var all = new List<(PushMessage, PushResult)>();
        foreach (var chunk in messages.Chunk(100))                  // at most 100 per request
        {
            using var res = await http.PostAsJsonAsync("--/api/v2/push/send", chunk, ct);
            res.EnsureSuccessStatusCode();                          // 429 or 5xx: retry later, with backoff
            var body = await res.Content.ReadFromJsonAsync<Tickets>(ct);
            all.AddRange(chunk.Zip(body!.Data));                   // tickets come back in message order
        }
        return all;
    }

    public async Task<Dictionary<string, PushResult>> ReceiptsAsync(IEnumerable<string> ids, CancellationToken ct)
    {
        var all = new Dictionary<string, PushResult>();
        foreach (var chunk in ids.Chunk(1000))                      // at most 1000 ids per request
        {
            using var res = await http.PostAsJsonAsync("--/api/v2/push/getReceipts", new { ids = chunk }, ct);
            res.EnsureSuccessStatusCode();
            foreach (var (id, r) in (await res.Content.ReadFromJsonAsync<Receipts>(ct))!.Data) all[id] = r;
        }
        return all;
    }
}
```

For each ticket: store the `Id` in `push_tickets` when `Status` is `ok`. Delete
the token when `Details.Error` is `DeviceNotRegistered`.

Rules for the payload:

- The whole payload is at most 4 KiB. `data` is for ids and a route, not for
  content. The app loads the content from the API.
- Do not put private details in the title or body. They show on the lock
  screen. "You have a new message" is safe. The message text is not.
- Put the screen to open in `data`, for example `{ "url": "/imports/123" }`.

### 7. Read the receipts and remove dead tokens

A ticket with `status: ok` means Expo received the message. It does not mean
Apple did. The **receipt** tells you that. Expo advises reading receipts 15
minutes after sending. It deletes them after 24 hours.

Run a job every 15 minutes:

1. Read `push_tickets` rows older than 15 minutes.
2. Ask for their receipts (at most 1000 ids per request).
3. For each receipt with `details.error` = `DeviceNotRegistered`: delete that
   token from `push_tokens`. Apple asks you to stop sending to it.
4. For `InvalidCredentials`: the APNs key is wrong or revoked. Log it as an
   error, so your error reporter tells you ([crash-reports.md](crash-reports.md)).
5. For `MessageRateExceeded`: slow down and retry with backoff.
6. Delete the ticket rows that got a receipt, and any older than 24 hours.

Log the error code, not the token.

### 8. Protect the send endpoint (recommended)

By default, anyone who has an Expo push token can send to that device through
Expo. Turn on **enhanced push security** in the EAS dashboard. Then every send
needs an Expo access token in `Authorization: Bearer ...`. Make an access token
in your Expo account settings. Put it in your app secrets as
`EXPO_ACCESS_TOKEN`, and list it in the API's `environment:` block in
`docker-compose.yml`. After you turn it on, requests without the token fail
with `UNAUTHORIZED`.

### 9. Handle a tap

With Expo Router, open the screen from `data.url`. This also works when the tap
launched the app:

```tsx
// app/_layout.tsx
import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";

function useNotificationTaps() {
  useEffect(() => {
    const open = (n: Notifications.Notification) => {
      const url = n.request.content.data?.url;
      if (typeof url === "string") router.push(url);
    };
    const last = Notifications.getLastNotificationResponse();   // the tap that opened the app
    if (last?.notification) open(last.notification);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification));
    return () => sub.remove();
  }, []);
}
```

Only accept routes inside your app. Check the user's access on the server when
the screen loads its data, as always.

## Send to APNs directly (the alternative)

You can skip Expo's service. Get the native token with
`getDevicePushTokenAsync()` and send it to your API. The server then:

- signs a JWT with your `.p8` key (algorithm ES256, your Key ID as `kid`, your
  Team ID as `iss`, and `iat`), and makes a new one every 20 to 60 minutes;
- sends each push over HTTP/2 to `https://api.push.apple.com` (TestFlight and
  App Store builds) or `https://api.sandbox.push.apple.com` (development
  builds), with your bundle ID as the `apns-topic` header;
- deletes a token when APNs answers `410` (`Unregistered`). A `400`
  `BadDeviceToken` often means the token belongs to the other environment.

It removes one third party from the path. It costs more code: HTTP/2, JWT
signing, one token per environment, and no receipts to lean on. Start with
Expo's service. Move when you have a reason.

## Testing

- **A real iPhone with a development build** is the main test. Get the token
  (log it in development builds only) and send with the Expo push tool at
  https://expo.dev/notifications, or with curl:

  ```bash
  curl -H 'Content-Type: application/json' -X POST https://exp.host/--/api/v2/push/send \
    -d '{"to":"ExponentPushToken[xxxxxxxx]","title":"hello","body":"world"}'
  ```

- **The iOS Simulator can receive real remote pushes**, but only in these
  conditions: Xcode 14 or later, a Simulator on iOS 16 or later, macOS 13 or
  later, on a Mac with Apple silicon or a T2 chip. It uses the APNs sandbox
  only, and each Simulator gets its own token. Expo's docs list the same
  support. The Simulator does not test the production APNs environment.
- **Fake a push without APNs**: `xcrun simctl push booted com.example.myapp payload.apns`,
  where the file holds `{"aps":{"alert":{"title":"hi","body":"test"}}}` plus
  your `data` keys. Good for the handler and tap routing. It proves nothing
  about keys or tokens.
- **Before release**, install the TestFlight build on a real iPhone and send one
  push to it from the production API. This is the only test of the production
  environment and the real key.

Your coding agent can drive the Simulator tests with `dev:test-loop`.

## App Review

- **Guideline 4.5.4:** push must not be required for the app to work. The
  "Don't Allow" path must still give a working app.
- **Guideline 4.5.4:** no promotions or direct marketing by push, unless the
  user opted in through consent text in your app's UI, and the app has a way
  to opt out. Keep a "Marketing" switch in settings, off by default, apart
  from the useful pushes.
- **Guideline 4.5.4:** do not send sensitive personal or confidential
  information in a push.
- **Guideline 5.1.1(iv):** respect the user's permission choice. Do not trick
  or force people into granting it.

`ship-ios:app-store-ready` looks for the usual rejection causes before you
submit.

## Privacy policy and App Privacy

Add a line like this to your privacy policy
([privacy-and-support-pages.md](privacy-and-support-pages.md)):

> If you turn on notifications, we store a device token with your account so
> we can send them. Notifications pass through Expo's push service and Apple
> Push Notification service. Expo does not store the content after delivery.
> You can turn notifications off in the iOS Settings app, and we delete the
> token when you sign out or delete your account.

Expo's FAQ says it keeps notification content only in memory and queues until
delivery. With direct APNs, name only Apple.

In App Store Connect's App Privacy answers, Apple's definitions do not name
push tokens. Your server links the token to the account. Read the
**Identifiers** definitions and decide for your app.

## Where the values go

| Value | Where |
|---|---|
| APNs key (`.p8`) and Key ID | EAS, through `eas credentials`; keep the file in your secrets tool. One key serves all your apps. |
| EAS `projectId` | the app config, written by `eas init` |
| Expo push tokens | `push_tokens` in the app's Postgres on the box |
| `EXPO_ACCESS_TOKEN` (enhanced push security) | your app secrets for production; listed under `environment:` in `docker-compose.yml` |

## Check it works

- On a real iPhone, a development build shows the permission prompt only when
  you turn the feature on, never at first launch.
- After "Allow", a row appears in `push_tokens` with your user id.
- A push from the Expo tool arrives with the app closed, and shows as a banner
  with the app open.
- Tapping it opens the screen from `data.url`, also from a cold start.
- Sign out: the row is gone. Sign in as another user on the same phone: the
  row belongs to the new user.
- Your API sends a push, and 15 minutes later the receipt job finds the
  receipt and deletes the ticket row.
- The TestFlight build receives a push from the production API.

## Common errors

- **"Project ID not found", or no token.** The app config has no EAS
  `projectId`. Run `eas init` in the app folder, then rebuild.
- **Works in the development build, not in TestFlight.** The APNs key is for
  Sandbox only, or EAS holds no key or a revoked one. Receipts show
  `InvalidCredentials`. Run `eas credentials` and set a Sandbox & Production
  key.
- **`InvalidProviderToken` in the receipt details.** Expo says this is tied to
  both the key and the provisioning profile. Make a new push key and profile
  with `eas credentials`, then rebuild.
- **No banner while the app is open.** No handler is set (SDK 57 and earlier),
  or a second `setNotificationHandler` call replaced yours.
- **The prompt never shows again.** The user said no once. `canAskAgain` is
  `false`. Offer a button that opens Settings.
- **Nothing arrives in Expo Go.** Expo Go has no push from SDK 53. Use a
  development build.
- **`DeviceNotRegistered` does not appear after you delete the app.** Apple
  decides when a token is dead. It takes an unknown time. This is normal.
- **Apple says you have too many APNs keys.** Reuse the `.p8` you already have.
  One team-scoped key works for all your apps.
- **`TOO_MANY_REQUESTS` or `PUSH_TOO_MANY_NOTIFICATIONS`.** More than 600 per
  second, or more than 100 messages in one request. Send in chunks of 100 and
  slow down.
- **The last user of a shared phone still gets pushes.** Sign-out does not
  delete the token row.
