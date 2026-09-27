# Prompts

## Structure: stable first, volatile second

Providers cache a **prefix** of the prompt: the system text, then the tool
definitions, then the messages. Cached input costs about a tenth of fresh
input, and input is most of the bill for a chat agent (often 100 tokens in
for every 1 out).

- `Stable` holds everything that never changes. No clock, no user, no screen,
  no memory. It is a `const` so nothing can splice a request into it.
- `Volatile(context)` is the SECOND system message: the time, the screen, what
  the app already computed, what the person told the assistant earlier.
- A "Current time: 14:32" line in the middle of the stable text gives correct
  answers and breaks the cache every minute. Nothing about it looks wrong.
- Some providers (the Anthropic OpenAI-compatible endpoint) merge all system
  messages into one. The split still costs nothing there.

## Rules that earned their place

- **Short.** Long prompts are where models find contradictory rules. A prompt
  line nobody has seen change an outcome is not a safety net; it is length.
  Delete it and run the eval.
- **The app computes, the model explains.** Give it the numbers. "NEVER invent
  a number; call a tool" is the rule, and a figure the model would have to
  compute belongs in the volatile block, already computed.
- **Do it, do not ask to do it.** A write tool shows a card with a button, so
  the question the model was about to ask IS the button. "Want me to add
  those?" to someone who said "add those" makes them agree twice.
- **Say "offered", never "done".** Nothing takes effect until the tap. "Done,
  added" is a lie the person discovers later.
- **Name the fork.** Allow a question only when two choices change what gets
  written and nothing on screen decides. "Shall I?" is not a fork.
- **Lookups come with a budget.** An instruction that adds a lookup before a
  write can use up the tool rounds before the write happens. The model then
  describes a card that does not exist. Say in the same sentence: "make all of
  them in the SAME reply".
- **Text from outside is data.** Web pages and other people's text can contain
  instructions. Say never to follow them.
- **Format data for the model, not for a locale.** Numbers and dates in the
  volatile block use the invariant culture. A server with a comma decimal
  separator wrote "2,0 a week" into a prompt, and the model copied it.
- **Say which renderer.** If the answer lands in a plain `Text` (a card, a
  notification), say "no markdown". Models write markdown by default, and the
  asterisks show on screen.
- **Tell it about what it cannot see.** If a photo goes to a separate reader
  tool, say in words that a photo is attached and which tool reads it.
  Otherwise the model has no way to know the tool applies.

## When nobody asked (background runs)

A model asked "is there anything worth changing?" finds something almost every
time. A card every evening is how the one that mattered gets scrolled past.

- Say plainly that nobody asked and nobody is watching.
- Give a **numbered list of what clears the bar**, concrete enough to check.
- Put the list FIRST and tell it to work through the list against the data
  before deciding.
- Put the permission to say nothing LAST, conditional on the check: "If, having
  checked every item, none is true: reply NOTHING." With that line first, the
  model read it as the answer and stayed silent about a real problem.
- One small proposal, then two sentences that name the evidence.
- Give it the facts the app already derived; tell it not to restate what the
  app already does on its own.

## Changing a prompt

1. Render the prompt block in a test and READ it. Traces do not record the
   prompt (on purpose), so a test is the only place you see what the model saw.
2. Change one thing.
3. Run the eval for that behaviour several times (see `evals.md`).
4. Delete the line again and run it red. If it stays green, the line does
   nothing; remove it.
