# App Store Connect API key

## What it is and what it costs

An App Store Connect API key lets tools talk to App Store Connect without your
Apple Account password or a two-factor prompt. It is a private key file
(`AuthKey_XXXXXXXXXX.p8`) plus two IDs. Tools sign a short-lived token with it
for each request.

onebox uses it for: uploads and signing in `expo-local-build` (through EAS),
build status and testers in `appstore-connect`, and screenshot uploads in
`app-store-screenshots`.

Free, part of the Apple Developer Program (`apple-developer.md`).

## Steps

You need the **Account Holder** role once (to request API access), and the
Account Holder or **Admin** role to make a team key.

1. Sign in to https://appstoreconnect.apple.com and open **Users and Access**.
2. Click **Integrations**. The page opens with **App Store Connect API**
   selected.
3. First time only: click **Request Access**, tick the box to agree to the
   terms, and click **Submit**. Apple reviews the request.
4. Click **Team Keys**, then **Generate API Key** (or the add button (+) if you
   already have keys).
5. Enter a name for your own reference, for example `onebox`.
6. Under **Access**, pick the role. **Admin** lets EAS create certificates and
   provisioning profiles as well as upload. **App Manager** is enough for
   uploads, TestFlight and metadata, but not for creating signing
   credentials. Team keys apply to all apps in the account.
7. Click **Generate**.
8. **Download the key now.** You can download the `.p8` file only once. Move it
   somewhere private, for example `~/.appstoreconnect/private_keys/`, and make
   it readable only by you: `chmod 600 AuthKey_*.p8`.
9. Copy two values from the same page:
   - the **Key ID** (10 characters, shown in the key's row, also in the file
     name),
   - the **Issuer ID** (a UUID, shown on the page above the list of keys).

You cannot edit a key's name or role later. To change them, revoke the key and
make a new one.

Individual keys (one per user, under your own profile) also exist. For onebox,
a team key is simpler.

## Where the value goes

In `~/.config/onebox/config.json` (never in a repo):

```json
{
  "apple": {
    "ascKeyId": "ABC123DEFG",
    "ascIssuerId": "00000000-0000-0000-0000-000000000000",
    "ascKeyPath": "/Users/you/.appstoreconnect/private_keys/AuthKey_ABC123DEFG.p8"
  }
}
```

Use a full path, not `~`. Some tools do not expand `~` and then report the
file as missing.

If you keep secrets in a secrets manager instead of on disk, store the
**contents** of the `.p8` file there and set a reference instead of the path:

```json
{ "secrets": { "tool": "1password" },
  "apple": { "ascKeyId": "ABC123DEFG", "ascIssuerId": "...", "ascKeyRef": "op://vault/asc-key/private-key" } }
```

`secrets.tool` can be `env` (the reference is an environment variable name),
`doppler` or `1password`. See `CONFIG.md`.

The key ID and issuer ID are not secrets on their own, but together with the
key they are. Keep all three out of public repos.

### EAS keeps its own copy

EAS can store an App Store Connect key on Expo's servers (`eas credentials`).
That copy is separate. If you rotate your key, update or remove the EAS copy
too, or builds and submits fail with "Apple 401 detected". The
`expo-local-build` skill passes your local key to eas on every build, so the
local key is the one that counts.

If you set the key in `eas.json` for `eas submit`, set all three of
`ascApiKeyPath`, `ascApiKeyId` and `ascApiKeyIssuerId`, or none.

## How to check it works

```bash
node <ship-ios>/skills/appstore-connect/scripts/asc.mjs apps
```

It should print your apps with their bundle IDs. It never prints the key.

## Common errors

- **401 NOT_AUTHORIZED.** The key ID, issuer ID and file do not belong
  together, the key was revoked, or the Mac's clock is far off (the token has
  a time window).
- **403 FORBIDDEN on some calls.** The key's role is too low for that action.
  Make a new key with a higher role.
- **403 on `POST /v1/apps`.** Expected. Apple does not allow creating apps
  through the API. Create the app record in the web UI
  (`app-store-connect-setup.md`).
- **"Apple 401 detected" in eas build or submit.** EAS used its own stale
  copy of the key. See "EAS keeps its own copy" above.
- **The download link is gone.** You can download a key only once. Revoke it
  and make a new one.
