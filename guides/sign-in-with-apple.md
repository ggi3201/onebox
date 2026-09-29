# Sign in with Apple

Runs on: your Mac (the app and the developer account) and your box (the
server check).

This guide adds Sign in with Apple to the Expo app, verifies Apple's token on
your own server, and adds account deletion with token revocation. On a hosted
backend, [hosted-backend.md](hosted-backend.md) has the token check and the
revoke step for Supabase, Convex and Firebase. The app side below is the same. It follows
the flow I use in my own apps.

Before you start you need a development build on your phone
([expo-app.md](expo-app.md), step 5) and the API on the box
([backend.md](backend.md)).

## What it is and what it costs

Sign in with Apple lets a user create an account with the Apple Account that
is already on their iPhone. Face ID, no password. The user can hide their real
email address. It is free and part of the Apple Developer Program
([apple-developer.md](apple-developer.md)).

### When App Review requires it

Guideline **4.8 (Login Services)**: if the app uses a third-party or social
login (Google, Facebook and others) for the user's main account, it must also
offer an equivalent login option. That option must limit data collection to
name and email, let the user keep their email private, and not collect app
activity for advertising without consent. Sign in with Apple meets all three.
There are exceptions (for example an app that uses only your own company's
account system), listed in the guideline.

Simplest path for a new app: make Sign in with Apple the only login.

Guideline **5.1.1(v)**: if the app lets users create an account, it must
also let them **delete the account inside the app**. Apple also asks apps that
use Sign in with Apple to **revoke the user's tokens** through its REST API
when the account is deleted. Step 6 does both.

## How the flow works

```
App                                   Your server                        Apple
 │ make random nonce N                    │                                 │
 │ signInAsync(nonce = SHA256(N)) ──────────────────────────────────────────>│
 │ <── identityToken (JWT), authorizationCode, fullName*, email* ───────────│
 │ POST /api/auth/apple {identityToken, nonce: N, fullName}                 │
 │ ──────────────────────────────────────>│ fetch keys (cached) ───────────>│
 │                                        │ verify signature, iss, aud,     │
 │                                        │ exp, nonce == SHA256(N)         │
 │                                        │ find or create user by `sub`    │
 │ <── your own access + refresh token ───│                                 │

 * fullName and email come on the first sign-in only.
```

The app never trusts itself. The server never trusts the app. Only Apple's
signature decides who the user is.

## Steps

### 1. Turn on the capability

The App ID for your bundle identifier needs the Sign in with Apple
capability. [app-store-connect-setup.md](app-store-connect-setup.md), step 1,
shows where App IDs live.

In the app config ([expo-app.md](expo-app.md)):

```json
{
  "expo": {
    "ios": { "bundleIdentifier": "com.example.myapp", "usesAppleSignIn": true },
    "plugins": ["expo-apple-authentication"]
  }
}
```

When EAS manages your signing, it syncs capabilities from this config to the
App ID on every build. That works both ways. A build from a directory with an
empty config **turns the capability off**. Keep the root tripwire from
[expo-app.md](expo-app.md), and read the "synced capabilities" line in the build log.

### 2. The button in the app

```bash
cd apps/mobile
npx expo install expo-apple-authentication expo-crypto expo-secure-store
```

Sign in with Apple needs a **development build**. In Expo Go the token is
issued for Expo Go's bundle ID, and your server rejects it (step 3).

```tsx
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { API_URL } from "../config/api";

export async function signInWithApple() {
  if (Platform.OS !== "ios" || !(await AppleAuthentication.isAvailableAsync())) {
    throw new Error("Sign in with Apple is not available on this device.");
  }

  // A fresh nonce per sign-in. Apple signs its SHA-256 into the token.
  // The raw value goes to your server, which checks the two match.
  const nonce = Array.from(Crypto.getRandomBytes(32), (b) => b.toString(16).padStart(2, "0")).join("");
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });
  if (!credential.identityToken) throw new Error("Apple returned no identity token.");

  // The name arrives only on the first sign-in. Send it now or lose it.
  const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
    .filter(Boolean).join(" ") || null;

  const res = await fetch(`${API_URL}/api/auth/apple`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identityToken: credential.identityToken, nonce, fullName }),
  });
  if (!res.ok) throw new Error(`Sign-in failed: ${res.status}`);
  return res.json(); // your server's tokens: store them with expo-secure-store
}
```

Use Apple's own button, `AppleAuthentication.AppleAuthenticationButton`.
Apple sets rules for how the button looks, and a home-made look-alike is an
easy way to break them. You may pick the style (black or white) and the
corner radius.

The user can cancel the Apple sheet. `signInAsync` then throws an error with
code `ERR_REQUEST_CANCELED`. Treat that as "no", not as a failure.

### 3. Verify the token on the server

Apple's identity token is a signed JWT. Your server must check, every time:

1. The **signature**, with Apple's public keys from
   `https://appleid.apple.com/auth/keys`. Pick the key whose `kid` matches
   the token header. Cache the keys; fetch again only for an unknown `kid`.
2. **`iss`** is exactly `https://appleid.apple.com`.
3. **`aud`** is your **bundle identifier**, `com.example.myapp`. This is the
   check that stops a token made for another app from logging in to yours.
4. **`exp`** is in the future.
5. **`nonce`** in the token equals SHA-256 (hex) of the raw nonce the app
   sent. Refuse a request that has no nonce. For extra safety, remember used
   nonces for a few minutes and refuse a repeat.

Node, with the `jose` library:

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";
import { createHash, timingSafeEqual } from "node:crypto";

const APPLE_KEYS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

export async function verifyAppleIdentityToken(identityToken: string, rawNonce: string) {
  if (!rawNonce || rawNonce.length < 32) throw new Error("missing nonce");

  const { payload } = await jwtVerify(identityToken, APPLE_KEYS, {
    issuer: "https://appleid.apple.com",
    audience: process.env.APPLE_CLIENT_ID,   // com.example.myapp
    algorithms: ["RS256"],
  });                                        // jwtVerify also checks exp

  const expected = createHash("sha256").update(rawNonce).digest("hex");
  const actual = String(payload.nonce ?? "");
  if (actual.length !== expected.length ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
    throw new Error("nonce mismatch");
  }

  return { sub: payload.sub!, email: (payload.email as string | undefined) ?? null };
}
```

.NET (my stack), with `Microsoft.IdentityModel`: fetch the
JSON Web Key Set, then

```csharp
var parameters = new TokenValidationParameters
{
    ValidIssuer = "https://appleid.apple.com",
    ValidAudience = bundleId,                 // com.example.myapp
    IssuerSigningKeys = appleKeys.GetSigningKeys(),
    ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
    ValidateLifetime = true,
};
// MapInboundClaims = false keeps "sub" as "sub". The default renames it to
// ClaimTypes.NameIdentifier, and step 4 then finds no user.
var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };
var principal = handler.ValidateToken(identityToken, parameters, out _);
// then compare principal's "nonce" claim with SHA-256 hex of the raw nonce
```

Log why a token was refused (bad audience, expired, bad signature). Do not
log the token itself. In .NET, write the log line as a `[LoggerMessage]`
method. The strict settings refuse `LogWarning(...)` (CA1848,
[agent-test-loop.md](agent-test-loop.md), step 3).

### 4. Find or create the user by `sub`

- **`sub`** is the stable user ID for your team. Use it as the key of the
  user record. It does not change when the user changes their email.
- **Email and name.** The app gets `fullName` and `email` in the credential
  **only on the first sign-in** for your app. After that they are `null`, even
  after a reinstall. Save them on the first request. Never match a returning
  user by email; match by `sub`.
- **Hidden email.** A user who hides their email gets an address at
  `privaterelay.appleid.com`. It forwards to their real inbox, but only for
  mail from senders you have registered with Apple. If your server sends email
  (receipts, password-free login links), register your sending domain or
  address in the Sign in with Apple email settings of your developer account.
- **An account without an email is normal.** Do not make email a required
  column.

### 5. Your own session

After the check, your server issues **its own** tokens: a short-lived access
token (a JWT signed with `JWT_SECRET_KEY`) and a longer refresh token. The
app stores both with `expo-secure-store` and sends the access token on every
request. It calls `POST /api/auth/refresh` for a new pair, and
`POST /api/auth/sign-out` to end the session on this device. The server side
is in [backend.md](backend.md), "Protect the API", step 7.

Do not use Apple's identity token as your session. It is short-lived, and
getting a new one needs the user to tap again.

### 6. Account deletion and token revocation

Put a "Delete account" action in the app's settings. It must delete the
account, not only sign out.

The flow:

1. The user confirms. The app calls `signInAsync` again (no scopes needed)
   to get a **fresh `authorizationCode`**. The code is single-use and valid
   for five minutes, so the one from the original sign-in is useless now.
2. The app calls `DELETE /api/account` with that code, using its normal
   access token.
3. The server exchanges the code for tokens:
   `POST https://appleid.apple.com/auth/token` (form data) with `client_id`
   (the bundle ID), `client_secret` (see below), `code`, and
   `grant_type=authorization_code`.
4. The server checks that the `sub` in the returned `id_token` is the user
   being deleted. If not, stop: the user signed in with a different Apple
   Account.
5. The server revokes: `POST https://appleid.apple.com/auth/revoke` with
   `client_id`, `client_secret`, `token` (the refresh token) and
   `token_type_hint=refresh_token`. Apple answers 200 with no body.
6. The server deletes the user's data, and the RevenueCat customer if you
   use it ([revenuecat.md](revenuecat.md)).

If Apple or the network fails in steps 3 to 5, still delete the account and
log the failure. The user asked for deletion; do not block it on Apple.

Deleting an account does not cancel an App Store subscription. Tell the user
before they confirm, and show them how to cancel it in the iPhone's
subscription settings.

#### The client secret

Apple's `auth/token` and `auth/revoke` endpoints want a `client_secret` that
is a JWT **you** sign with a Sign in with Apple private key:

- header: `alg` = `ES256`, `kid` = the key's 10-character Key ID
- `iss` = your 10-character Team ID
- `iat` = now, `exp` = at most six months later (five minutes is plenty)
- `aud` = `https://appleid.apple.com`
- `sub` = your bundle ID (the same value as `client_id`)

```ts
import { SignJWT, importPKCS8 } from "jose";

const pem = process.env.APPLE_SIGNIN_PRIVATE_KEY!.replace(/\\n/g, "\n");
const key = await importPKCS8(pem, "ES256");
const clientSecret = await new SignJWT({})
  .setProtectedHeader({ alg: "ES256", kid: process.env.APPLE_SIGNIN_KEY_ID! })
  .setIssuer(process.env.APPLE_TEAM_ID!)
  .setIssuedAt()
  .setExpirationTime("5m")
  .setAudience("https://appleid.apple.com")
  .setSubject(process.env.APPLE_CLIENT_ID!)
  .sign(key);
```

#### Make the Sign in with Apple key

1. In your Apple Developer account, open the Keys page (under Certificates,
   Identifiers & Profiles).
2. Create a new key. Enable Sign in with Apple for it, and pick your app's
   App ID as its primary App ID.
3. Download the `.p8` file. **Apple lets you download it only once.** Note the
   Key ID.
4. Put the `.p8` text straight into your secrets tool as
   `APPLE_SIGNIN_PRIVATE_KEY`. Do not commit it, do not paste it into a chat.

One key can serve several apps in the same team.

This is a different key from the App Store Connect API key
([app-store-connect-api-key.md](app-store-connect-api-key.md)). They are not interchangeable.

## Where the values go

| Value | Secret? | Where |
|---|---|---|
| Bundle ID (`APPLE_CLIENT_ID`) | no | `docker-compose.yml` `environment:`, and `ios.bundleIdentifier` |
| Team ID (`APPLE_TEAM_ID`) | no | `apple.teamId` in the onebox config; the API's environment |
| Key ID (`APPLE_SIGNIN_KEY_ID`) | no | the API's environment |
| `.p8` contents (`APPLE_SIGNIN_PRIVATE_KEY`) | **yes** | your secrets tool only; listed by name in the compose `environment:` |
| `JWT_SECRET_KEY` (your session key) | **yes** | your secrets tool only |

Many secrets tools store a multi-line PEM with literal `\n`. The code above
turns those back into newlines before it reads the key.

## Check it works

1. Install a development or preview build on your iPhone. Sign in.
2. The server log shows a verified `sub`, and a new user row exists.
3. Sign out and sign in again. The same user row is used. `fullName` and
   `email` from the app are `null` this time; that is expected.
4. Delete the account in the app. The row is gone. The server log shows the
   revoke returned 200.
5. On the iPhone, open the list of apps that use Sign in with Apple in your
   Apple Account settings. Your app is no longer there. The next sign-in asks
   for name and email again, like the very first one.

Step 5 is also how you test the first-sign-in path again: remove the app from
that list, then sign in.

## Common errors

- **Invalid audience.** The token's `aud` is not your bundle ID. You are in
  Expo Go, or `APPLE_CLIENT_ID` on the server has a typo, or it holds a
  Services ID (that is for Sign in with Apple on the web).
- **Nonce mismatch.** The app sent the hashed nonce to the server instead of
  the raw one, or hashed it twice. Apple gets the hash; your server gets the
  raw value.
- **Sign-in fails for everyone after a build.** The capability was turned off
  on the App ID. See step 1.
- **`invalid_client` from `auth/token`.** The client secret is wrong: wrong
  Key ID, Team ID or `sub`, the key does not have Sign in with Apple enabled,
  or the PEM has broken newlines.
- **`invalid_grant` from `auth/token`.** The authorization code was already
  used or is older than five minutes. Get a fresh one right before the delete
  call.
- **The name is always empty.** The user signed in to your app before, maybe
  in an earlier test. Remove the app from their Sign in with Apple list and
  try again.
- **App Review rejects under 4.8.** You offer another social login and no
  option that meets 4.8's privacy points. Add Sign in with Apple.
- **App Review rejects under 5.1.1(v).** Account deletion is missing or hard
  to find, or it only deactivates the account instead of deleting it.
