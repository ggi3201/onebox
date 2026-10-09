---
name: app-store-screenshots
description: Design, capture, render and upload App Store screenshot sets (the marketing images on an app's store page) for an iOS app, in the app's own fonts and colours, from real UI captures. Use whenever the user wants App Store screenshots, "appstore images", store preview images, marketing screenshots for the listing, a redo or critique of an existing set, better simulator captures for a slide, or to upload or replace screenshots on App Store Connect. Not for app icons (use draw-app-icon) or App Preview videos.
---

# App Store screenshots

Runs on: your Mac (the Simulator and a headless Chrome). Uploading runs
anywhere with an App Store Connect API key.

Build a set of store images that look like the app itself, not like a
template. Use real captures, straight devices, the app's own type and colours,
and one signature idea. Render them to exact sizes. Upload only when asked.

The bundled pieces:

- `assets/template.html`: a strip of slides, with a phone frame and lifted
  crops.
- `scripts/render.cjs`: renders the strip to exact-size opaque sRGB PNGs and
  makes an overview. Needs `playwright` and `sharp` (see the file header).
- `scripts/sheet.py`: contact sheets to survey sources, and old-vs-new
  comparisons. Needs Pillow.
- `scripts/asc.mjs`: lists App Store Connect state, and replaces screenshots
  with a backup first.
- `references/design.md`: what reads premium or tacky, composition patterns,
  lift maths, copy rules. **Read it before you lay out slides.**
- `references/capture.md`: how to find good content and drive the simulator
  for clean captures.
- `references/asc.md`: display types, sizes, the 6.5" vs 6.9" slot trap, and
  the upload steps.

## 1. Gather the evidence

- **Existing sets and raw captures.** Look on the Desktop, in marketing
  folders and in earlier exports. Read any README or art-direction notes. If
  the user compares you with an earlier set, look at it closely and name what
  is weak about it.
- **The design system in code.** Read the theme or tokens file (colours, type
  scale, radii) and the comments in it. Find the font files, often in
  `node_modules/@expo-google-fonts/*` or `assets/fonts`. Read the landing page
  copy for the voice and for claims you may make.
- **Captures.** Make a contact sheet with
  `python3 <skill-dir>/scripts/sheet.py grid out.png --cols 8 <files>`. Note the
  resolution of each capture. If the best screens are weak or low-res, plan
  to capture new ones (step 3).

## 2. Plan the set

Write down:

- **The signature device, and why it fits this brand.** See design.md.
- **Up to ten slides; eight is a good default.** For each: the screen, the
  headline (2–5 words), the sub line, and the composition pattern. Slides 1–3
  appear in search results, so they carry the pitch.
- **The grounds.** Two or three palette colours, in a rhythm.

If one maker ships several apps, keep the sets visibly different: own grounds,
own signature, own type.

## 3. Capture what is missing

When a key screen looks weak, get a better one. Follow capture.md:

1. Clean the status bar.
2. Pick attractive content from the dev database or API.
3. Deep-link to it.
4. Capture at full resolution with `simctl io screenshot`.
5. Clear the status bar override afterwards.

## 4. Build and render

Use one folder per set, for example `<out>/myapp/`:

```
myapp/source/index.html      # from assets/template.html
myapp/source/assets/*.png    # copies of the captures, never the originals
myapp/source/fonts/*.ttf     # the app's own font files
```

Then run:

```bash
node <skill-dir>/scripts/render.cjs <out>/myapp
```

- The output goes to `myapp/iphone-6.9/NN-<data-name>.png` (1320×2868) and
  `myapp/myapp-overview.png`.
- The script fails if an image did not load, or if a size or alpha channel
  is wrong.
- Name each slide with `data-name` from its headline, so the file names
  explain themselves.

## 5. Review, then iterate

- Read the overview, then look at a few slides at 50%. Fix what design.md's
  review loop lists, and render again. Three or four passes is normal. Do not
  hand over a first draft.
- If there is an earlier set, run `sheet.py compare` with the old set on top
  and the new set below. Show it to the user.

## 6. Hand over

- Put the set in one folder, with a short README: the copy per slide, the
  rules you followed, how to re-render, and known limits (a soft low-res
  source, a foreign-language item, no iPad set).
- Show the comparison or overview image.
- Report plainly: what changed, what you did not change, and anything the user
  should know before uploading.

## 7. Upload (only when asked)

Follow asc.md. The script uses the same App Store Connect API key as the
`appstore-connect` skill (onebox config `apple.*`). If there is no key, point
the user to `https://onebox.lokkesveen.com/guides/app-store-connect-api-key.md`.

1. Run `asc.mjs list`.
2. Confirm "replace" versus "add", unless the user already said.
3. Run `replace --dry-run`.
4. Run the real replace. It backs up and deletes the old screenshots, then
   uploads, orders and waits for COMPLETE.

The script never submits for review. Tell the user where the backup is.

## Rules that hold throughout

- **Real UI only.** Crop and scale captures. Never repaint, regenerate or
  "fix" UI, people, prices or results. Do not use AI-generated background art
  unless the user asks for it.
- **Claims must be true.** Every claim must be visible in a capture, or stated
  by the app's own site. App Review wants accurate metadata (guideline 2.3),
  and screenshots that show the app in use, not only a login or splash screen
  (2.3.3).
- **Work on copies.** Never modify the user's original captures.
- **Outward actions need an explicit request.** Uploading to App Store
  Connect is one. Deleting screenshots is permanent, so back up first.

## Finish

End with one line: the next step, as one question. "Next: <step>. Continue?".
"Yes" must be enough. Take the step from the app's plan (`/start:plan`). If
something blocks it, name only that one thing, in plain words, and offer the
fix.
