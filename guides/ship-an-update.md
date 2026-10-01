# Ship an update

Runs on: your Mac (the app and the builds), your box (the API), and your
browser (App Store Connect).

Version 1.0 is live. Now you want to ship 1.1, or a quick fix. This guide
joins the parts that already exist: a new build or an EAS Update, the
version number, a backend change that keeps old builds working, a test on
staging, the What's New text, TestFlight, review, a phased release, and what
to do when something goes wrong.

Come back to this guide for every release. It is not a one-time step.

## What it costs

Nothing new. The builds are local and free ([expo-eas.md](expo-eas.md)).
TestFlight, App Review and phased release are part of the Apple Developer
Program. EAS Update has a free tier; the `ship-ios:eas-update` skill has the
numbers.

## Steps

### 1. A new build or an EAS Update?

An EAS Update replaces only the JavaScript and the assets on phones that
already have your build. It skips App Review. A new build goes through
TestFlight and App Review. Pick by what changed:

| What changed | Ship |
|---|---|
| JavaScript or TypeScript, styles, text, images in the bundle | an EAS Update, or a build |
| A new package with native code (most `expo-*` packages, `react-native-*` with an `ios/` folder) | a build |
| The app config: a config plugin, a permission text in `infoPlist`, an entitlement, the icon, the splash screen | a build |
| `version` in `app.json` | a build |
| An Expo SDK or React Native upgrade | a build |
| A new feature, even if it is JavaScript only | a build, through App Review |

The last row is Apple's rule, not a technical one. Downloaded code may fix
and polish the app. It may not change what the app is for (App Review
Guideline 2.5.2). Ship new features through review.

Not sure? The fingerprint decides. With the `fingerprint` runtime policy,
an update reaches only builds with the same runtime version. Compare the
runtime version of the live build with the one of your branch:

```bash
cd apps/mobile
git switch --detach v1.0.0     # the tag of the build that is live (step 2)
npx expo-updates runtimeversion:resolve --platform ios
git switch -                   # back to your branch
npx expo-updates runtimeversion:resolve --platform ios
```

The same value: an EAS Update can reach the live build. A different value:
make a build. The `ship-ios:eas-update` skill sets up the policy, publishes
the update and explains why one did not arrive. This guide does not repeat it.

### 2. Raise the version

Apple uses two numbers ([expo-app.md](expo-app.md), step 7). EAS raises the
build number on every production build. You raise `version` in `app.json`,
once per release, **after a version went live**:

- `1.0.0` to `1.0.1` for a fix,
- `1.0.0` to `1.1.0` for something new.

One version can have many builds in TestFlight. Once a version is live,
Apple refuses new uploads with that version or a lower one.

Tag the commit of each build you submit, so you can find it again:

```bash
git tag v1.1.0 && git push origin v1.1.0
```

With the fingerprint policy, `version` is one of the fingerprint's inputs
by default. So raising it gives a new runtime version. An update made after
the raise reaches only the new build. To fix the old build with an update,
publish from its tag.

### 3. Backend first, app second

Old builds stay on phones for months. Some users turn automatic updates
off. A phased release (step 7) keeps most users on the old version for a
week on purpose. So the API must serve the old app and the new app at the
same time.

Deploy the backend change first. Check that the old app still works. Ship
the app after that.

**Change the API so the old app keeps working:**

- Add, do not change. A new field in a response is fine: the old app ignores
  it. A new endpoint is fine.
- Do not rename or remove a field the old app reads. Do not change what a
  field means, or its type.
- A new input the old app does not send gets a default on the server.
- A change that cannot be backward compatible gets a new route, for example
  `/api/v2/orders`. Keep the old route until no supported build calls it.

**Migrations that keep the old app working.** Migrations run when the API
starts ([backend.md](backend.md), step 5). Split a breaking change over two
releases:

1. **Expand,** with this release. Add the new column or table. A new column
   is nullable or has a default. Copy the old data into it. The API writes
   both and reads the new one.
2. **Contract,** in a later release. Drop the old column only after every
   supported build has stopped reading it. Raise the minimum version first
   (below). Make a backup before (`sudo onebox-backup` on the box).

A rename, for example `name` to `display_name`, is an expand (add
`display_name`, copy, return both names) and later a contract (drop
`name`).

**A minimum-version check.** It lets the server tell a build that is too old
to update, instead of failing in odd ways. The app sends its `version` in an
`X-App-Version` header on every request ([expo-app.md](expo-app.md), step 7).
The server compares it with `MIN_APP_VERSION`. A lower version gets `426`
and `{"error":"update_required"}`. A request with no header goes through:
that is curl, the health check, or a build from before the header.

Add the header to the app before the first release. A build without it can
never be told to update.

The app (`src/api/client.ts`):

```ts
import Constants from "expo-constants";
import { API_URL } from "../config/api";

// The `version` from app.json, as built into this binary.
const APP_VERSION = Constants.expoConfig?.version;

export class UpdateRequired extends Error {}

export async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (APP_VERSION) headers.set("X-App-Version", APP_VERSION);
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 426) throw new UpdateRequired();
  return res;
}
```

Catch `UpdateRequired` in one place, at the root of the app. Show one full
screen: "Please update the app", with a button that opens the store page
(`https://apps.apple.com/app/id<ascAppId>`, the numeric Apple ID from
`eas.json`). Show it only for `426`, never for other errors.

.NET (`Program.cs`), in the same order as the middleware in
[backend.md](backend.md):

```csharp
// The oldest app version the API still serves. Raise it only on purpose.
// Write it with three parts, like the app does: System.Version says 1.2 < 1.2.0.
var minAppVersion = Version.Parse(builder.Configuration["MIN_APP_VERSION"] ?? "1.0.0");

var app = builder.Build();
app.UseForwardedHeaders();
app.Use(async (ctx, next) =>
{
    // No header: curl, the health check, or a build from before the header.
    if (ctx.Request.Path.StartsWithSegments("/api")
        && Version.TryParse(ctx.Request.Headers["X-App-Version"].ToString(), out var v)
        && v < minAppVersion)
    {
        ctx.Response.StatusCode = StatusCodes.Status426UpgradeRequired;
        await ctx.Response.WriteAsJsonAsync(new { error = "update_required", minVersion = minAppVersion.ToString() });
        return;
    }
    await next();
});
```

Node (Express):

```js
// The oldest app version the API still serves. Raise it only on purpose.
const MIN_APP_VERSION = process.env.MIN_APP_VERSION ?? "1.0.0";

const older = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
};

app.use("/api", (req, res, next) => {
  const v = req.get("X-App-Version");
  // No header: curl, the health check, or a build from before the header.
  if (v && /^\d+\.\d+\.\d+$/.test(v) && older(v, MIN_APP_VERSION)) {
    return res.status(426).json({ error: "update_required", minVersion: MIN_APP_VERSION });
  }
  next();
});
```

Fastify: the same check in an `onRequest` hook.

List `MIN_APP_VERSION` under the API's `environment:` in the compose file.
Compose passes on only what that block lists ([backend.md](backend.md),
step 3). The value is not a secret.

Raise `MIN_APP_VERSION` rarely: for a security fix, or before a contract
migration. Raise it only after the new version has been out to all users
for some days. It stops every older build at once.

### 4. Test on staging, with a preview build

Test the new API and the new app together before real users see them:

1. Push the backend change to a `qa/**` branch. Skill: `box:staging-env`.
   It deploys a second API and database on the same box, for example
   `https://api-stg.example.com`. The migration runs there first.
2. Build the new app as a preview build, pointed at staging, and install it
   on your phone. Skill: `ship-ios:ios-preview-build`.
3. Use the main feature end to end.

Check the old app too. Make a preview build from the last release tag,
pointed at staging. Or, right after the production deploy, open the App
Store build on your phone and use the main feature.

### 5. Write What's New

Every version after the first needs What's New text. Write what changed
for the user, most useful first. Not internal work. Skill:
`ship-ios:store-listing`. It checks the length and can push the text to App
Store Connect.

The promotional text can change at any time, without a new version. Use it
for news.

### 6. TestFlight first, then submit

1. Build and upload. Skill: `ship-ios:expo-local-build`. Then
   `ship-ios:appstore-connect` waits for processing.
2. Install the TestFlight build on your phone. Use the main feature against
   the production API.
3. Run `ship-ios:app-store-ready` again. A new feature can bring a new
   rejection cause, such as a new permission.
4. In App Store Connect, add a new iOS version with the same number as
   `version`. Pick the build, fill in What's New, and update the review
   notes if a new feature needs them.
5. Submit. Guide: [submit for review](https://onebox.lokkesveen.com/guides/submit-for-review/).

On the version page you can choose to release the version yourself after
approval. Then you pick the moment, not App Review. That is useful when the
backend must deploy first.

### 7. Release in phases

A phased release gives the update to users with automatic updates turned
on, over seven days. A crash then hits a few users, not all of them. Turn
it on before you submit: on the version page, in the section **Phased
Release for Automatic Updates**. It exists for updates only, not for the
first version.

| Day | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| Share of users | 1% | 2% | 5% | 10% | 20% | 50% | 100% |

- Anyone can still update by hand from the App Store, on any day.
- **Pause Phased Release** stops it. You can pause for 30 days in total, as
  often as you like. On resume it goes on from the day it stopped.
- **Release to All Users** ends it early and gives the update to everyone.

Checked on 2026-10-01 at
https://developer.apple.com/help/app-store-connect/update-your-app/release-a-version-update-in-phases.

Watch crash reports and support email during the first three days. Guide:
[crash-reports.md](crash-reports.md).

An EAS Update has its own staged rollout (`--rollout 10`). The
`ship-ios:eas-update` skill covers it.

### 8. When something goes wrong

**A bad EAS Update.** Roll it back. Phones go back to the update before it,
or to the code in the build. Skill: `ship-ios:eas-update` (its step 4).

**A JavaScript bug in a store build.** If the runtime version of the live
build matches (step 1), publish the fix as an EAS Update from that build's
tag.

**A bad native build.** You cannot roll back a store build. Apple has no way
to give users the old build again. Do this:

1. Pause the phased release. Users who have the bad version keep it. No new
   users get it through automatic updates.
2. Fix forward: raise `version` (`1.1.0` to `1.1.1`), build, test in
   TestFlight, submit.
3. For a critical bug, ask Apple for an expedited review:
   https://developer.apple.com/distribute/app-review/ ("Expedited reviews").
4. If the server can work around the bug, do that meanwhile. For a bug that
   damages data, raise `MIN_APP_VERSION` above the bad version once the fix
   is live.

**A bad backend deploy.** Revert the commit and push. The deploy workflow
puts the old API back. A migration that only added things (expand) needs no
undo. A migration that dropped data needs the backup. That is why the drop
waits for a later release.

## Where the values go

| Value | Where |
|---|---|
| `version` | `expo.version` in `app.json`, raised once per release |
| Build number | EAS, on its servers (`"appVersionSource": "remote"`) |
| `MIN_APP_VERSION` | the API's environment; list it under `environment:` in `docker-compose.yml` |
| Release tag | git: `v1.1.0` on the commit of the build you submit |
| What's New | the version page in App Store Connect, or `whatsNew` in `ship-ios:store-listing`'s file |

## Check it works

The minimum-version check, with `MIN_APP_VERSION=1.0.0`. Use any `/api`
route:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'X-App-Version: 0.9.0' https://api.example.com/api/me   # 426
curl -s -o /dev/null -w '%{http_code}\n' -H 'X-App-Version: 1.0.0' https://api.example.com/api/me   # not 426 (401 without a token is fine)
curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/api/me                             # not 426
```

After the release:

- The App Store page shows the new version and its What's New text.
- On your phone, update from the App Store. The main feature works.
- The old build still works: check it during the phased release, or ask a
  tester who has not updated.

## Common errors

- **The upload fails: the version must be higher than the previously
  approved version.** `version` is still the live one. Raise it (step 2) and
  build again.
- **An EAS Update does not reach users on the old version.** You raised
  `version` or changed native code, so the runtime version changed. Publish
  from the old build's tag, or ship a build.
- **The old app breaks right after a backend deploy.** The API removed,
  renamed or changed a field the old app reads. Revert the deploy. Bring the
  field back, and split the change into expand and contract (step 3).
- **Every user sees "Please update".** `MIN_APP_VERSION` is above the live
  version. Or, on .NET, it has two parts (`1.2`) while the app sends three
  (`1.2.0`).
- **No phased release option on the version page.** It is the first
  version. Phased release exists for updates only.
- **Some users are still on the old version after day 7.** They turned
  automatic updates off. That is normal. The minimum-version check is for
  them.
- **`Cannot find native module` after an EAS Update.** The update needed
  native code that the build does not have. This happens with the
  `appVersion` runtime policy, not with `fingerprint`. Roll the update back
  (step 8), ship it as a build, and switch to `fingerprint`
  (`ship-ios:eas-update`).
