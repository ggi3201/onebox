# Worked example: a garment family

This family was drawn for a wardrobe app. It shows the method in full: one
contract, one cue per subject, and the repair that fixed each common failure.

## Contract

- `viewBox 0 0 24 24`, stroke 1.5, round caps and joins, `fill="none"`,
  `stroke="currentColor"`.
- Garments in flat lay (as if laid on a table). Footwear in side profile.
- Proof at 26, 34 and 40 px, in a light grey (`#D4D4CF`) and a mid grey
  (`#A3A39E`) on a warm off-white (`#F5F5F0`). These are the proof script's
  defaults.

## Where they were used

- Empty category tiles: top, trousers, shoe, outerwear, knit, dress.
- Photo placeholders: person, top. The empty wardrobe: hanger.
- Action buttons kept the app's existing icon library. Custom icons were only
  for content, never for actions.
- Icons were decorative inside labelled UI, so they carried no accessibility
  label of their own.

## Cues and repairs

| Subject | Recognition cue | Failure and repair |
| --- | --- | --- |
| Top | Collared shirt, short sleeves, straight torso | Collar becomes a knot: simplify its points and remove buttons. Keep the centre seam away from the collar folds except where they meet on purpose. |
| Trousers | Waistband and two long separated legs | Reads as a skirt: deepen the central V and widen the gap near the hems. Do not add pockets to compensate. |
| Outerwear | Long sleeves, lapels, a visibly open centre | Reads as a shirt: keep two separate front edges and a clear opening all the way to the hem. No closed placket. |
| Knit | Crew neck, cuff bands, ribbed hem | Reads as a tee: lengthen the sleeves and keep the cuff and hem bands. Two spaced rib marks are enough; dense hatching turns to mud. |
| Dress | Neck and shoulders, fitted waist, widening skirt | Reads as a triangular sign: strengthen the bodice and waist before adding skirt detail. |
| Shoe | Low upper, smooth toe, separate heel | Reads as a sneaker: remove the thick continuous sole, add a heel break, lower the collar. No laces, no logos. Lift the whole shape until its visual centre matches the garments. |
| Person | Head circle and an open shoulder arch | Reads as an account badge: remove any enclosing circle and any face. Keep head and shoulders apart. |
| Hanger | Hook, neck, wide triangular shoulder bar | Hook becomes a dot: open its curve and leave room above the shoulder joint. |
| Palette | Rounded asymmetric board and a thumb hole | Reads as a cookie: make the thumb hole unmistakable. Use a few spaced hollow wells, no filled spots. |
| Swatch | Square with exactly one generously rounded corner | Reads as a document: no folded-corner diagonal. Keep the other three corners square. |

## Lessons from this family

- The plausible confusions were shirt / jacket and trousers / skirt. Putting
  those pairs side by side in the proof found every real problem. Enlarged
  views found none.
- The shoe was the hardest. Its long, low shape sat visibly lower than the
  garments until it was lifted above its box centre.
- The light grey placeholder colour looked weak in screenshots. It was kept,
  because that is how the app really shows empty tiles.
- The project kept a small preview generator with an explicit list of icon
  names. A new icon had to be added to that list, and to any native gallery
  screen, or it never appeared in the proof.
- The gallery screen imported only the icons, not full screens or animation
  libraries. Importing more made Expo Go fail on unrelated native module
  version mismatches.
- If `react-native-svg` is missing, install the Expo-compatible version with
  `npx expo install react-native-svg` and rebuild the dev client. Do not
  upgrade an existing renderer just to draw an icon.
