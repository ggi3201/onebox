# Designing the set

Read this before you lay out any slide.

## What reads as premium, and what reads as tacky

The first set in this workflow was judged "a little tacky". Its faults were
common ones, so avoid them by default:

| Tacky | Instead |
|---|---|
| Generated background art (fabric photos, etched props, painted food) | Brand colour grounds, the app's own imagery, type |
| Tilted or floating 3D phones | Straight devices. Vary size, position and crop instead |
| Wordmark + tracked-caps eyebrow + hairline header on every slide | No repeated header. The app name appears once, on the hero or the close |
| The same two-tone headline formula on all eight | Use the accent line sparingly, and vary the layout between slides |
| Cycling a new background colour every slide | Two or three grounds from the palette, in a deliberate rhythm |
| Copy that promises what the screen does not show | Every claim visible in a screen, or stated in the app's own landing page |

Premium sets share a few traits. There is one idea per slide. The headline is
big enough to read in search results, where the images are about a thumb
wide. The UI is sharp. There is one signature device used with restraint.

## Stay inside the app's styling

"Stay within the realm of styling" means the set looks like the app, not like
a template. So:

- Read the theme or tokens file and the landing page first. Copy hex values
  and cite the file in a CSS comment.
- Use the app's own font files, from node_modules or assets. Do not use a
  lookalike.
- Honour the design notes written in the code. For example, one app's tokens
  said "no tracked uppercase labels" and "brass means a record". The set then
  used no tracked caps, and it used brass only on a record number.
- Keep the app's voice. If the app gives its screens names, such as "The
  Library" and "The Studio", the set can use those as section labels.

## A signature device

Pick one per app. It should come from the brand, not from a trick library.

- **Numbers as the hero (a data or fitness app):** a huge real number from a
  capture, set in the app's display face. Examples: `1:50`, `+13.7%`,
  `370 kcal left`. The real capture sits nearby to prove it.
- **A continuous line through the strip (a name or idea about thread,
  paths or routes):** one SVG path across all slides. It passes behind the
  phones and ties a small knot only in open space, never on a slide edge,
  because the App Store shows gaps between slides. Change its colour per
  ground with two clipPaths.
- **Editorial prints (fashion or food):** crops of the real photos inside
  the app, laid out as small prints with a caption. For example, "You" and
  "The pieces" next to the try-on result.
- **A cinematic dark ground (food or lifestyle):** a deep brand colour with
  a soft radial glow behind the device. Food photos glow on it.

## Composition patterns

Mix three or four of these across a set of eight:

1. **Hero:** big headline at the top, one large phone cropped by the bottom edge.
2. **Zoom lift:** a phone, plus one crop of the same capture at 1.35–1.5×,
   centred over the region it came from. Make it wider than the phone so it
   reads as a zoom.
3. **Typographic:** a giant number or phrase, a thin progress rule, the real
   UI crop, and a phone rising from the bottom.
4. **Bleed:** the phone offset to the left or right and cut by the edge. Use
   it for list screens that are long and uniform.
5. **Pair:** two phones, staggered. Use it for before and after, light and
   dark, or two outfits. Check that the key detail on the back phone is not
   hidden by the front phone.
6. **Close:** the brand name, one line of voice, and a calm screen.

The first three slides show in search results, so they carry the pitch. Put
the most striking one first and the core loop next.

## Lift crops: the maths

Screens are placed at `s_phone = (w - 2 * pad) / sourceWidth` logical px per
source px. Here pad is `w * 0.026`. A region at source (x, y, w, h) sits in
the phone at:

```
left = phoneLeft + pad + x * s_phone
top  = phoneTop  + pad + y * s_phone
```

Centre the lift on that point. At a 3× render, `data-s = 1/3` is native
resolution. Going above about 0.37 upscales, and the text starts to blur.
Crop just inside rounded corners and chips, or the corners of the page
background will show.

## Type details that bite

- Tabular figures widen the colon and the decimal point in many grotesques.
  Set giant numbers with `font-variant-numeric: normal`.
- Measure headlines in a render. A 46–56px display line on 440px wraps
  sooner than you expect. Shorten the copy instead of shrinking the type.
- Captions under about 13px vanish at thumbnail size. Keep the sub line at
  16–19px.

## Copy

- Write a headline of 2–5 words, plus a sub line of about 12 words at most.
  Use the user's words, not feature names.
- Only claim what is on screen, or what is on the app's site or in its privacy
  page. For example, "voice cooking" was allowed because the privacy page
  describes it.
- Keep one language. If a capture contains words in another language, choose
  a different capture or leave that screen out.

## Review loop

After each render, read the overview. Then zoom into two or three slides at
50%. Look for: text that collides or wraps, duplicate UI peeking out under a
lift, a thread or line that cuts through a face, a half-knot on a slide edge,
and a blurry upscaled capture. Fix, and render again. Expect three or four
passes.
