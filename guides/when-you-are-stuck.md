# When you are stuck

Runs on: your Mac, with your coding agent.

Everyone gets stuck: a build fails, Apple rejects the app, a change does not
show up. Your agent can fix most of it, if you give it the right facts and
the right skill. This page says how, and when to stop and ask a person.

## First, the facts

Before you ask, collect these. An agent with the facts fixes it in one try.
An agent with a guess tries five things.

- **The exact error, in full.** Copy the text, do not retype it. The
  *first* error in a long log is usually the real one. The last one is often
  a result of the first.
- **What you ran,** and from which folder.
- **What you expected,** and what happened instead.
- **What changed since it last worked:** a new package, an update, a new
  build, a changed setting.
- **For a screen problem, a screenshot.**
- **For an App Review rejection, Apple's message word for word,** with the
  guideline number (for example 5.1.1). Do not summarise it.

Take secrets out first. If a log shows a key or a token, replace it with
`<redacted>` before you paste it. See [secrets.md](secrets.md).

## Then, the right skill

Most problems have a skill made for them. Ask your agent to use it by name.

| What you see | Ask your agent to run |
|---|---|
| Apple rejected the app, or you ask "will Apple reject this?" | `ship-ios:app-store-ready`, with the rejection text |
| The iOS build or the upload fails | `ship-ios:expo-local-build`. Its pitfalls list has the common errors |
| The build is uploaded but not in TestFlight, or says "Missing Compliance" | `ship-ios:appstore-connect` |
| Your change does not show up on the simulator | `dev:test-loop`. Its preflight finds a wrong Metro or a missing native rebuild |
| The agent says "fixed", but you are not sure | `dev:test-loop`, and ask for the screenshot |
| A test build talks to the wrong server, or has no API URL | `ship-ios:ios-preview-build` |
| The box, a container or a backup looks wrong | `box:box-setup`, the `check` phase |
| A URL does not load, or DNS looks wrong | `box:expose-service`, with its audit |
| A staging deploy fails | `box:staging-env` |
| You do not know what is next | the plan skill (`/start:plan`). It ticks what is done and shows the next step |

## A prompt that works

```text
<what you ran, and from which folder>
Expected: <what should happen>
Got: <what happened>
Error (first lines):
<paste>
It last worked: <when, and what changed since>
Use <skill> if it fits. Find the cause before you change anything,
and tell me what you will change.
```

"Find the cause before you change anything" matters. Without it, an agent
often changes things until the error goes away, and a new problem appears
later.

## When the agent goes in circles

You know the signs: the same fix twice, a new error after each change, or
"it should work now" with no proof.

1. **Stop it after two or three tries.** More tries rarely help.
2. **Ask for the cause, not a fix:** "Explain why this fails. Do not change
   any files yet."
3. **Go back to what worked.** `git status` shows what changed. `git diff`
   shows how. `git restore <file>` undoes a file. Commit before a big change,
   so you always have a way back.
4. **Start a fresh session** with a short summary: the goal, what you tried,
   the error. A long session full of failed attempts misleads the agent.
5. **Ask it to read the source:** the guide for this step, or the tool's own
   documentation, instead of working from memory.

## When to ask a person

Ask when the problem is outside your code: your Apple account, a payment
setting, an App Review decision you do not understand, or the same error
after a fresh session.

- **Apple:** the [Apple Developer Forums](https://developer.apple.com/forums/),
  or Contact Us in your developer account for account and payment problems.
  For a rejection, reply to App Review in App Store Connect. You can ask what
  exactly they want changed.
- **Expo and EAS:** the [Expo Discord](https://chat.expo.dev/) and the
  [Expo forums](https://github.com/expo/expo/discussions).
- **RevenueCat:** the [RevenueCat community](https://community.revenuecat.com/).
- **This kit:** a skill or a guide is wrong or unclear?
  [Open an issue](https://github.com/ggi3201/onebox/issues/new?template=dogfood.md)
  with the prompt above. Your agent can do it with
  `gh issue create --repo ggi3201/onebox --label dogfood`. Take out your app's
  name, hosts and secrets first: issues are public. No GitHub account? Write
  to me at [geir@lokkesveen.com](mailto:geir@lokkesveen.com). I read
  everything, but I build this next to a day job, so I cannot promise a fast
  answer.

## Check it works

- You can name the first error, not only the last one.
- Your agent found a cause before it changed files.
- The fix is proven: a passing test, a screenshot, or a build in TestFlight.
