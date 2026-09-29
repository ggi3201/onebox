# Click-through flows

A flow is a short script in plain English. It says what to tap and what the
screen must show. The coding agent runs it in the iOS Simulator with its
simulator tool. A human can run it by hand from the same file.

A flow is not an automated end-to-end test. Nothing runs it in CI. It is a
checklist that the agent follows before it says a feature works.

## Where flows live

Next to the feature they check, in the same folder as the feature's screens
and hooks:

```
src/features/checkout/
  CheckoutScreen.tsx
  useCheckout.ts
  checkout.test.ts
  checkout.flow.md          <- the happy path
  checkout-declined.flow.md <- one edge case, if it matters
```

The name is `<feature>.flow.md` or `<feature>-<case>.flow.md`. A flow sits
next to the code, so a diff that touches the feature also shows its flow. The
agent finds it with:

```bash
git diff --name-only main... | xargs -n1 dirname | sort -u \
  | xargs -I{} find {} -maxdepth 1 -name '*.flow.md'
```

With expo-router, only `.js`, `.jsx`, `.ts` and `.tsx` files in `app/` become
routes. A `.md` file there is ignored. Still, keep flows in the feature folder
(for example `src/features/`), not in `app/`, so that `app/` holds only
routes.

## How to write one

- **One path per file.** The happy path first. Add a second file for an edge
  case only when it has broken before, or when it involves money or data loss.
- **Short.** Aim for 5 to 15 steps. A longer flow is two flows.
- **Name what a person sees.** Use the visible text or the accessibility label:
  `Tap "Place order"`. Never write coordinates in the file. They change with
  the device.
- **Every step that changes the screen has an `Expect`.** State what must be
  on screen, and what must not be (a spinner, an error, an empty list).
- **Name the seed data it needs.** "Sign in as the dev user with 3 items in
  the cart." The seed must make that state exist (see `seed-data.md`).
- **Start from a known place.** A deep link, or a fresh launch.
- **Update it in the same commit** as a change to the button text or the
  screen order. A stale flow fails, and that is correct.

Verbs to use, so every flow reads the same:

| Verb | Meaning |
|---|---|
| `Open <deep link>` | `xcrun simctl openurl <udid> "<link>"`, or launch the app |
| `Tap "<label>"` | tap the element with this text or accessibility label |
| `Type "<text>" into "<field>"` | tap the field, then type. Emoji or letters outside ASCII: paste them (see Pitfalls) |
| `Swipe up / down / left / right` | scroll or swipe the main content |
| `Wait for "<text>"` | re-take the screenshot until the text shows, up to 10 s |
| `Back` | the back button, or a swipe from the left edge |
| `Expect: ...` | take a screenshot and check it. Stop on a mismatch |

Give each control the flow taps an `accessibilityLabel` in the code. VoiceOver
needs it anyway. It also lets a simulator tool that reads the accessibility
tree find the control by name.

## Full example

`src/features/lists/lists.flow.md`:

```markdown
# Lists: create, see, empty state

Feature: src/features/lists/
Needs: seed users `dev-empty` (no lists) and `dev-rich` (40 lists, one with
a 120-character name). See the seed file.
Proof: save a screenshot at every step marked (proof).

## Empty state
1. Sign in as `dev-empty`. Open `myapp://lists`.
   Expect: the title "Lists". The text "No lists yet". A "New list" button.
   Not: a spinner that stays more than 3 s. Not: an error banner. (proof)

## Create
2. Tap "New list".
   Expect: a sheet with a "Name" field, focused, and the keyboard up.
3. Type "Weekend 🏕️ trip" into "Name". Tap "Save".
   Expect: the sheet closes. "Weekend 🏕️ trip" is the first row. The emoji
   shows as one emoji, not as boxes. (proof)
4. Close the app and open it again (terminate, then launch).
   Expect: "Weekend 🏕️ trip" is still there. The server saved it.

## Many lists and a long name
5. Sign out. Sign in as `dev-rich`. Open `myapp://lists`.
   Expect: rows show. The 120-character name wraps or truncates with "…".
   Not: text that runs off the screen or overlaps the row's count. (proof)
6. Swipe up until the end of the list.
   Expect: 40 rows in total, no duplicates, no blank row at the end. A second
   page loaded (look for the row "List 40").

## Data stays apart
7. Stay as `dev-rich`. Search for "Weekend".
   Expect: no result. That list belongs to `dev-empty`. (proof)
```

## How the agent runs a flow

1. Run the preflight (`scripts/preflight.mjs`). Do not start a flow on a
   simulator that runs another checkout's code.
2. Pick one simulator and use its UDID for every command. With two booted,
   `booted` picks either one.
3. Put the app in the state the flow needs: seed the database, sign in as the
   named user. Grant permissions up front so no system alert blocks a tap:
   `xcrun simctl privacy <udid> grant photos <bundle-id>` (also `location`,
   `contacts`, `calendar`, `microphone` and more: see
   `xcrun simctl privacy help`). The camera is not in that list, and the
   Simulator has no camera. Test camera screens on a real phone.
4. For each step: act, then take a screenshot, then compare it with `Expect`.
   Read the screenshot. Do not assume the tap worked.
5. Stop at the first mismatch. Report the step number, what you expected,
   what you saw, and the screenshot path. Do not "fix" the flow to match a
   broken screen.
6. Save proof screenshots outside the repo, or in a git-ignored folder, and
   list their paths in the report.

### Which tool does what

Use whatever simulator tool this session has.

- **An iOS Simulator MCP tool** (some agent apps have one built in, and
  community servers exist): screenshot, tap, swipe, type text, press buttons,
  open a URL. Taps are usually in **points**, not pixels. Check the tool's
  description for the device size it reports.
- **`xcrun simctl`**, always there with Xcode, but it cannot tap:
  - Screenshot: `xcrun simctl io <udid> screenshot /path/shot.png`
  - Deep link: `xcrun simctl openurl <udid> "myapp://lists"`
  - Put text on the pasteboard: `printf '%s' '<text>' | LANG=en_US.UTF-8 xcrun simctl pbcopy <udid>`
  - Launch fresh: `xcrun simctl launch --terminate-running-process <udid> <bundle-id>`
  - Terminate: `xcrun simctl terminate <udid> <bundle-id>`
  - Dark mode: `xcrun simctl ui <udid> appearance dark`
  - Large text: `xcrun simctl ui <udid> content_size accessibility-extra-large`
  - Clean status bar: `xcrun simctl status_bar <udid> override --time 9:41`
- **No tap tool at all?** Run the steps you can (deep links, screenshots). Say
  plainly which steps you could not run, and ask the user to tap through them.

### Pitfalls

- **Pixels vs points.** A `simctl` screenshot is in pixels. Current iPhones
  are 3x, so a 1320 × 2868 screenshot is a 440 × 956 point screen. Divide by
  the scale before you tap by coordinates.
- **`openurl` with a custom scheme** can show an "Open in <app>?" dialog. Tap
  "Open" with your tap tool. Without one, launch the app and navigate instead.
- **The keyboard covers the button.** Dismiss it, or scroll, before you tap.
  If the button stays covered, that is a bug to report.
- **Emoji and letters outside ASCII get garbled.** A simulator tool's "type
  text" can read UTF-8 as Mac Roman: `Café` arrives as `Caf√©`, and an emoji
  as a few odd symbols. The tool reports success anyway, and the app saves
  what it got. The step then tests the tool, not the app. Paste such text
  instead:
  ```bash
  printf '%s' 'Weekend 🏕️ trip' | LANG=en_US.UTF-8 xcrun simctl pbcopy <udid>
  xcrun simctl pbpaste <udid>    # must print the text exactly
  ```
  Keep `LANG=en_US.UTF-8`. With a non-UTF-8 locale, `pbcopy` garbles the
  text in the same way. Then long-press the field and tap "Paste". To replace
  text, tap "Select All" first. Take a screenshot and read the field. That is
  the check, not the tool's result.
- **A red or yellow box (LogBox)** is a failure, even if the screen behind it
  looks right. Read the message.
- **Animations.** Wait a second and take the screenshot again before you
  decide a step failed.
- **Sign in with Apple does not work in the Simulator.** Use a dev-only sign-in
  (see `seed-data.md`).

## When to run flows

- **You changed a feature:** run the flows in that feature's folder.
- **You changed shared code** (navigation, auth, the API client, theme): run
  every flow that passes through it. When unsure, run the happy path of each
  main tab.
- **Before a release:** run every flow, on a fresh install, on the smallest
  and the largest simulator you support.
- **After a native rebuild:** run the flows of the feature that needed it.

## Maestro, only for the extreme case

[Maestro](https://maestro.mobile.dev) runs YAML flows unattended. It is worth
it only when a flow must run in CI, without a person or an agent, on many
devices. For most solo apps it is overkill now. The agent can drive the
simulator itself, and a plain-English flow costs nothing to keep. If you do
adopt Maestro, keep the `.flow.md` as the spec and generate the YAML from it.
