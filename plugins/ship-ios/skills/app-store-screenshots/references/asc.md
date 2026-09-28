# Uploading to App Store Connect

Uploading changes a live listing. Deleting screenshots cannot be undone. Only
do it when the user asks. Ask whether to replace or to add, unless they
already said which. `scripts/asc.mjs` always backs up before it deletes.

## Display types and sizes

Check Apple's current spec before relying on this table:
https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications

| API display type | Slot | Portrait sizes |
|---|---|---|
| `APP_IPHONE_67` | 6.9" (and 6.7") | 1320×2868, 1290×2796, 1260×2736 |
| `APP_IPHONE_65` | 6.5" | 1284×2778, 1242×2688 |
| `APP_IPAD_PRO_3GEN_129` | 13" iPad | 2064×2752, 2048×2732 |

Rules to remember:

- One iPhone set is required: 6.9", or 6.5" if there is no 6.9" set. An iPad
  set is required if the app runs on iPad (`ios.supportsTablet: true`).

- A 1320×2868 set goes in `APP_IPHONE_67`. It is rejected in `APP_IPHONE_65`.
- If the 6.9" set exists, Apple scales it down for smaller iPhones. But an
  existing 6.5" set still shows on 6.5" devices. So to replace an older
  listing fully, clear `APP_IPHONE_65` as well: pass
  `--clear APP_IPHONE_67,APP_IPHONE_65`.
- Each set takes 1–10 images, opaque (no alpha), in RGB.
- Leave iPad sets alone unless you made iPad images.

## Steps

```bash
node scripts/asc.mjs list      # apps, editable versions, locales, current counts
node scripts/asc.mjs replace --app <bundleId> --dir <set>/iphone-6.9 \
  --clear APP_IPHONE_67,APP_IPHONE_65 --dry-run
node scripts/asc.mjs replace --app <bundleId> --dir <set>/iphone-6.9 \
  --clear APP_IPHONE_67,APP_IPHONE_65 --backup <set>/../asc-backup
```

- Screenshots can only be changed on an editable version, such as Prepare
  for Submission or Rejected. If there is none, tell the user. Creating a new
  version is their call.
- The script works on one locale (default `en-US`). Run it once per locale
  that should get the set. Do not put English images into other locales
  without asking.
- Upload flow, for when you need to debug it:
  1. POST `appScreenshots` (fileName, fileSize) returns the upload operations.
  2. PUT each part.
  3. PATCH with `uploaded: true` and the MD5 `sourceFileChecksum`.
  4. PATCH the set's relationship to fix the order.
  5. Poll `assetDeliveryState` until it is `COMPLETE`.
- The script never submits for review. Say so in the report.

## Credentials

The script uses the same App Store Connect API key as the `appstore-connect`
skill. It reads the onebox config (`apple.ascKeyId`, `apple.ascIssuerId`, and
`apple.ascKeyPath` or `apple.ascKeyRef`), then `ASC_KEY_ID` / `ASC_ISSUER_ID` /
`ASC_KEY_PATH`, then `~/.appstoreconnect/config.json`. If none exists, point
the user to `https://onebox.lokkesveen.com/guides/app-store-connect-api-key.md`. Never print the key.

The key needs a role that can edit app metadata (App Manager or Admin).
