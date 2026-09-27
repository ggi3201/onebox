---
name: draw-icon-set
description: Draw and refine a cohesive family of small outline SVG icons for any subject (categories, empty states, placeholders, tab bars, onboarding), and prove they read at the size they ship at. Produces editable SVG files or React Native components with literal paths, plus a proof sheet at real pixel sizes. Use when the user asks for custom icons, a matching icon set, glyphs for categories or empty states, "icons in our style", to extend an existing icon family, or says an icon is unreadable or looks like something else when small. Not for app logos or app icons (use draw-app-icon) or raster illustrations.
---

# Draw an icon set

Runs anywhere. The proof sheet opens in any browser. No image generation, no
design service and no paid API.

Produce editable vector paths that stay legible at their shipping size. The
defaults below suit a quiet editorial outline family. An explicit brief, or an
existing family in the project, wins over them.

## Start with a small drawing contract

Read the brief and two neighbouring icons if a family exists. Write down:

- the subjects,
- the smallest size they ship at,
- stroke, colour and background,
- **one recognition cue per subject** (what makes a boot a boot and not a sock).

If the brief is silent, use these defaults:

- `viewBox="0 0 24 24"`, stroke `1.5`, `fill="none"`.
- `stroke="currentColor"`, round caps and joins. Size and colour belong to the
  caller.
- Proof sizes 26, 34 and 40 CSS px, in the faint placeholder colour and the
  normal colour the app uses, on the app's own background.
- Keep stroke extents inside the box: at least 0.75 units from any edge for a
  1.5-unit stroke, usually more. Avoid non-scaling strokes.
- One consistent view per family: flat front view for most objects, side
  profile where the side is what people recognise (shoes, cars, animals). No
  shading and no perspective.
- Keep distinct interior features about 2 viewBox units apart. This is a
  heuristic. It does not allow erasing an essential join.

Do not replace an existing family because these defaults differ from it.

## Draw cheaply, then inspect

1. Read `references/drawing.md` for silhouette construction, the neighbour
   check and common repairs. Pick one outer contour and only the details that
   carry recognition.
2. Edit existing source when there is some. For a new React Native component,
   adapt `assets/Glyph.tsx.template`. Otherwise write a standalone SVG. Use
   literal `d` values: no runtime XML parsing, no embedded raster images.
3. Make **one candidate per subject** first. For a new, hard silhouette,
   compare at most two deliberate variants. Do not produce speculative style
   alternatives.
4. Build a proof from the real files (below). Open the HTML in a browser,
   take a screenshot at 100% zoom, and look at it. Check the smallest size
   first. Enlarged views help diagnose; they cannot prove small-size
   legibility.
5. Repair the one cue that fails (the gap between legs, a jacket opening, a
   heel) and render again. If two focused revisions still leave it ambiguous,
   report which cue fails and ask for review. Do not declare it finished, and
   do not redraw the whole set again and again.
6. Integrate only when asked. Keep the app's action icons (the icon library it
   already uses) and the surrounding layout. For React Native, compile types
   and use the SVG renderer the project already has.

## Proof helper

```sh
python3 <skill-dir>/scripts/proof.py --out /tmp/icon-proof.html path/to/*.svg
python3 <skill-dir>/scripts/proof.py --out /tmp/icon-proof.html path/to/icons/*.tsx
# another family contract, and the app's own colours:
python3 <skill-dir>/scripts/proof.py --out /tmp/p.html --stroke-width 2 \
  --sizes 20,24,32 --colors '#C7C7CC,#3A3A3C' --bg '#FFFFFF' icons/*.svg
```

The helper accepts one SVG root with literal path children that match the
family contract. It rejects anything else instead of silently dropping it. It
writes a self-contained HTML sheet, not a screenshot. TSX mode extracts
literal geometry and checks the wrapper; it does not run React Native. For
components with state or logic, check in the real app renderer.

## Completion check

- Each subject is recognisable at the smallest size without its label.
  Plausible confusions sit side by side in the proof (shirt / jacket, cup /
  glass, trousers / skirt).
- Negative spaces stay open, stroke weight is even, nothing clips, and the
  visual mass sits in the centre. A long object often needs lifting above its
  naive box centre.
- The faint placeholder colour is meant to be faint. Do not change the palette
  to make a screenshot look better. Use the colours the app really uses.
- Every requested subject, size and colour is in the proof.
- Deliver the editable files and a real screenshot of the proof, with a short
  note on what you checked. Say plainly whether evidence is from a browser, a
  simulator or a device. If a native launch failed, give the browser proof and
  say the native check is still open.

For a hand-off to another agent, give the source path, the recognition cue,
the known visual issue, and the output path. A helper agent works on its
assigned icons only, and returns its smallest-size screenshot and any
remaining ambiguity.

A worked example of a full family, with cues and repairs per subject:
`references/example-garments.md`.
