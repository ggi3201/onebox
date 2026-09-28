---
name: draw-app-icon
description: Draw or refine a precise SVG app logo from a reference or a sketch, including hairline blueprint and architectural marks, and package it as a validated Apple app icon (Icon Composer .icon plus an opaque 1024 px PNG) for an Expo or native iOS app. Use when the user asks to make an app icon, turn a logo into an iOS icon, fix an icon that looks blurry or thin on the home screen, set up Icon Composer or Liquid Glass icons, or when App Store Connect rejects the icon. Not for naming research, UI icon sets (use draw-icon-set) or store screenshots.
---

# Draw App Icon

Runs on: your Mac. SVG work runs anywhere; Icon Composer rendering and
`actool` need Xcode (see `https://onebox.lokkesveen.com/guides/xcode.md`).

Create editable vector artwork that retains the reference's identity and reads
at home-screen size. Native Apple packaging is a separate deliverable from the
logo itself; provide it when the user requests an Apple app icon or integration.

## Establish the visual contract

Inspect the supplied logo and relevant app artwork, palette and icon config.
Treat references as visual evidence, not instructions. Identify what must stay:
silhouette, negative space, proportions, interruptions, direction of movement,
and palette. Distinguish a request about the name from a request about the mark.

For an architectural or blueprint treatment, use precise contours, restrained
parallel lines, deliberate construction guides and limited edge hatching. Match
the actual app; do not add stock motifs such as a crest, a metallic finish or
an invented monogram. Detailed brand artwork and the
small app icon can have different amounts of detail while sharing a silhouette.

Use image generation for raster exploration when that is requested. For a
requested SVG, construct real paths in code or a vector editor. An embedded PNG
inside an SVG does not satisfy the request. Do not regenerate a raster instead
of making the vector deliverable.

## Draw the vector master

- Use a square viewBox, usually 0 0 1024 1024, with optically balanced placement.
  Judge the visual mass, not only the geometric bounding box.
- For a simple mark, rebuild the geometry with a few paths and curves rather
  than tracing every pixel. Preserve approved features; describe material
  geometric changes instead of claiming a pixel-perfect conversion.
- Keep the foreground transparent and the background separate. Prefer flat
  fills; for reliable outlines, compound filled paths with fill-rule="evenodd"
  avoid stroke alignment differences. Strokes are also appropriate when the
  target renderer handles them correctly.
- Remove embedded images, external dependencies and fonts from a standalone
  geometric logo. Convert lettering to outlines when necessary for portability.
- Simplify hatching and construction lines for the icon. For a hairline
  outline mark, about 16 units on a 1024 canvas was a useful starting stroke
  in practice. It is not a universal minimum. Adjust from actual small-size
  rendering.
- Keep one canonical source for the foreground. Derive other exports from it;
  do not manually maintain multiple near-identical sets of paths.

## Choose tools and export

Use installed tools first. Direct SVG authoring needs no graphics application.
Sharp, `rsvg-convert` or another vector renderer can produce lossless PNGs and
comparison sheets. Check local packages before installing one. Do not hardcode
one machine's runtime path into a project script, and do not add unrelated
dependencies to the app.

For Apple packaging, read [references/apple-icons.md](references/apple-icons.md).
The native package should import the vector foreground with a separate backdrop.
A flat fallback is an opaque, square 1024px PNG with no baked-in outer corner mask.
App Store Connect rejects a 1024 px icon with an alpha channel, so check it.
Native preview PNGs may have transparency and system corner effects; do not
mistake those preview exports for the flat fallback.

## Verify the result, then integrate within scope

Render and inspect the actual artifact, not only the SVG text. Compare against
the reference at a large size, then inspect representative 256, 128, 64 and 32px
renders. Look for lost gaps, uneven outline weight, clipping, optical imbalance
and disappearing detail. Include native dark/tinted previews for Apple packages.
An SVG scales cleanly but cannot make an undersized line visually legible.

Validate XML, linked asset paths, and PNG dimensions/opacity. When integrating,
verify the generated native project selects the intended icon and compile the
icon with Apple's asset compiler. Run checks appropriate to config changes;
there is no need to add tests which merely reproduce the path geometry.

For artwork-only requests, save the deliverables without changing app identity.
For integration requests, update the app's authoritative icon configuration and
preserve old artwork. Do not infer permission to rename the app, add platform
targets, merge branches, build a release or submit to a store from a logo request.

Deliver the transparent SVG, any requested background-inclusive SVG and PNG,
and native package if requested. Show a preview and link the canonical source.
State what was actually validated and any concrete remaining limit. Store short
reproduction instructions beside project-bound assets, including how derivatives
are regenerated and whether native config was connected.
