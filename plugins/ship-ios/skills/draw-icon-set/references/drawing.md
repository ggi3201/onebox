# Drawing recipes

Use these as a method, not as fixed coordinates. Draw the outside first. Add
an interior line only if removing it changes what the icon reads as. Most
icons need one contour plus one to three detail paths. That is not a hard cap.

## Choose the recognition cue

For each subject, name the one feature that separates it from its nearest
neighbour in the set. Then protect that feature at the smallest size.

| Subject | Cue | Its likely confusion |
|---|---|---|
| Mug | Handle loop, open on the inside | a jar, a bucket |
| Wine glass | Stem and a bowl wider than the foot | a lamp, a trophy |
| Boot | Tall shaft plus a foot | a sock |
| Book | Spine line and page edge on one side | a box, a tablet |
| Bicycle | Two equal circles with a frame between | a pair of glasses |
| Leaf | Midrib and one asymmetric tip | a feather, a teardrop |

A worked family with ten subjects is in `example-garments.md`.

## Construct a new subject

- Choose a characteristic outline. A boot has a shaft plus a foot. A scarf is
  a long draped strip with two ends. Reuse the family's stroke, but not another
  icon's silhouette when that would confuse the two.
- Use `M/L/H/V/Z` for straight, tailored edges and `Q/C/A` for soft contours.
  Prefer a few editable control points to many short segments. For symmetric
  objects, mirror coordinates around the centre (x = 12) instead of eyeballing
  each side.
- Aim for roughly 18 to 21 units of useful extent on the dominant axis. Do not
  stretch naturally wide or narrow objects into the same rectangle.
- Where closed outlines cross, overlapping strokes look darker. Remove the
  duplicate segment instead of thinning the whole icon.

## The neighbour check

An icon is never judged alone. It is judged next to the icons it will sit
beside.

- Put each icon in the proof next to its likely confusion, not in alphabetical
  order.
- Check at the smallest size first, then the larger ones.
- Count CSS pixels, not the physical pixels of a retina screenshot.
- Compare visual weight across the row. One icon with more interior lines
  reads darker and "louder" than its neighbours, even at the same stroke.
- Compare vertical centre. Icons in a row should look level, which often means
  they are not geometrically level.

## Fast repair loop

Describe the visible failure in one sentence ("the trousers read as a skirt").
Change only the relevant contour or spacing. Render again from source and
compare before and after at the same size. Do not tune stroke, spacing and
silhouette at the same time, unless the whole style contract is changing. Keep
the old candidate until the new one has been inspected.
