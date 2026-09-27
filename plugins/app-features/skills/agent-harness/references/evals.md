# Evals

An eval runs the real model with the real prompt and tools, and asserts on
what it DID. A prompt has no behaviour until a model reads it, so reading
`SystemPrompt.cs` cannot answer "why does it ask instead of acting".

## Rules

1. **Opt-in.** `APP_EVAL=1`, or the test returns at once. No key: say so and
   return. `dotnet test` must never spend money quietly, and CI stays green on
   a machine with no key. Ask the user before running evals.
2. **Assert on tool calls and proposals, not on prose.** "Did it call
   `list_items`" has a data answer. "Does it sound helpful" does not.
3. **Fail on "did nothing" by itself.** A run that proposed nothing passes
   every assertion about WHAT it proposed. Assert that there is a proposal
   first, on its own line.
4. **Report a rate.** Run each case several times (three at least) and report
   `passes/runs`. One pass is an anecdote. A number with no denominator bigger
   than one is not a measurement.
5. **Red before green, at the same number of runs.** Delete the prompt line the
   eval guards and run it again. If it stays green, either the line does
   nothing or the eval cannot fail. One team deleted a paragraph, got 2/3
   still passing, and almost removed a paragraph that cut bad proposals from
   one in three to none.
6. **Delete the whole family.** When a behaviour has two guards (a prompt line
   AND a tool refusal), removing one at a time stays green. Remove both to see
   it fail.
7. **A keyword check on prose can be unfailable.** An eval that counted the
   name of the app's own supported format as "flagging a limitation" passed on
   the exact sentence that hid the limitation. Every word in such a check
   should be a negation or a hedge ("cannot", "only supports", "approximate"),
   never a word the model uses while doing the wrong thing.
8. **Encode the reported failure, not your taste.** Assert the bug is gone
   (the reported bad value no longer appears), with slack. An eval that also
   encodes an opinion fails for reasons nobody can act on.
9. **Use real inputs.** A stock photo tells you nothing about a phone photo in
   bad light. Keep a folder of real, consented test inputs.

## Running

```bash
APP_EVAL=1 Llm__BaseUrl=... Llm__Model=... Llm__ApiKey="$KEY" \
  dotnet test --filter Category=Eval
```

Tag each slice (`[Trait("Slice", "Chat")]`) so one area's evals run alone
while you work on it.

## Sweeps

To choose a model for a narrow task (reading a photo, parsing a phrase), run a
table of real cases against two or three models, five runs each. Record the
pass rate, the cost per call and the time to first token. Pick on those
numbers, then write the winner and the date next to the model constant.
