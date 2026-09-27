# Chat UX that holds up

## Proposals, not actions

- The assistant proposes; the person taps Apply. The card sits under the
  sentence that explains it. A card that outlives its conversation is a
  change nobody remembers agreeing to.
- Validate the commands when the card arrives (to show what it WOULD do) and
  again on Apply (state may have changed; the person may have done it by hand).
- Apply through the same code path as the app's own buttons, so undo, sync and
  validation are the same.
- A decided card stays on screen, disabled, with the outcome.
- A card that would do nothing is not drawn. The model's sentence already
  explains why.
- If some writes apply straight away (edits to something not yet saved, a
  memory about the person), say so in the transcript at the moment it happens,
  and give a settings screen to edit or delete it.

## Tool status

- Show a chip per tool call: a spinner, then the server's one-line summary.
- Map tool names to words ("Looking through your items"). A raw name reads
  like a log line.
- Every `toolStart` gets a `toolResult` from the server, also on failure, so a
  spinner always stops. If you add a tool on the server, check the chip ends.

## Photos

- Shrink on the phone: 1024 px long edge, JPEG 0.7. Resize only DOWN.
- Show the thumbnail in the user's bubble at once. It is the only sign the
  photo went anywhere until the answer arrives.
- Only the newest photo is sent. The model's words about earlier photos are
  in the history.
- If different kinds of photo go to different models (a cheap reader for
  receipts, the main model for everything else), let the PERSON choose with
  two buttons. The file cannot tell you, and the model cannot decide before it
  has seen it.
- Every non-result of the picker (cancel, no permission, a photo still
  downloading from iCloud) returns null. Do not show an error over a question
  already typed.

## Errors, in the app's voice

- "Buy this" (402 `entitlementRequired`) opens the paywall; it is not a message.
- "Wait until the 1st" (429 `budgetExhausted`) names the reset date. It must
  not read like the rate limit ("give it a minute"), because waiting does not help.
- The UI should not normally reach `entitlementRequired`: gate the chat entry
  point on the subscription. The server check covers the race where it lapsed
  while the sheet was open.

## Modals on iOS

A second `Modal` does not present over one that is already up. If the chat is
in a Modal, draw the consent prompt and the paywall step INSIDE it (as an
overlay), not as their own Modals. A component test that asserts on the
container cannot see a Modal's content at all; test the overlay.

## Context the server needs

Send, with every turn: the screen (`view`), the device time (`clientNow`) and
the time zone. The server puts them in the volatile prompt. Never send data
the server can read itself; send ids and let the tools read.

## Persistence

Default: the thread lives in memory and is gone on reset. Persist only if
people ask to come back to a conversation. If you do, scope the storage key
by user id and clear it on sign-out.
