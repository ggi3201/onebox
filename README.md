<div align="center">

# onebox

**Get your app on the App Store.**

Agent skills and plain guides that take an Expo / React Native app from idea to
the App Store: signing, TestFlight, the store page and App Review. Most apps
need no server. If yours does, it can run on one cheap box.

![MIT license](https://img.shields.io/badge/license-MIT-blue)
![iOS only](https://img.shields.io/badge/platform-iOS-lightgrey)
![Claude Code plugins](https://img.shields.io/badge/Claude%20Code-plugins-d97757)
![Skills as plain SKILL.md](https://img.shields.io/badge/skills-plain%20SKILL.md-green)

[Site and guides](https://onebox.lokkesveen.com) ·
[Example plan](https://onebox.lokkesveen.com/example-plan/) ·
[For agents: llms.txt](https://onebox.lokkesveen.com/llms.txt)

</div>

## What it feels like

You tell your coding agent your idea. It makes the repo, checks your Mac, and
then walks you through the rest one step at a time. Each step is one question.
"Yes" is enough to go on.

```
You:    I have an idea for an iPhone app: a warranty keeper.

Agent:  Next: Make your app's repo. Continue?
You:    yes

Agent:  Done: your app runs in the Simulator.
        Next: One place for your secrets. Continue?
You:    yes

Agent:  Next: Sign in with Apple. This part is yours: turn it on for your app
        in your Apple Developer account (2 minutes, I will show you where).
        Ready when you are.
```

No checklist to read first. The agent checks what your Mac and your app
already have. It speaks up only when something blocks the next step, and then
only about that one thing. The full plan is in `PLAN.md` if you want it.

## Who it is for

- **Yes:** a developer who has never shipped an iOS app, and wants the whole
  road in one place: signing, TestFlight, the store page and App Review.
- **Yes:** someone who already ships, and wants the repeatable parts done the
  same way every time.
- **Not yet:** someone who has never used a terminal. The skills explain each
  step, but they assume you can run a command and read an error.
- **Not covered:** Android and the Play Store. iOS only for now.

## Quick start

In Claude Code:

```
/plugin marketplace add ggi3201/onebox
/plugin install start@onebox
```

In Codex:

```
codex plugin marketplace add ggi3201/onebox
codex plugin add start@onebox
```

Then open your agent in an empty folder and describe your idea. Or run
`/start:new-app` to make the repo, and `/start:plan` later to see what is done
and what is next. Run `/start:plan` again after each step. It ticks what you
finished.

In Codex, a skill starts with `$` instead of `/`: `$start:new-app`,
`$start:plan`.

Other agents (Cursor, Gemini CLI and more):

```
npx skills add ggi3201/onebox
```

Installed this way, the skills have flat names: `/start:plan` is `plan`, and
in Claude Code it hides the built-in `/plan`. In Claude Code, install the
plugins instead (above).

The skills are plain `SKILL.md` files, so any agent that reads them can use
them. I build and test with Claude Code.

To get fixes later, in Claude Code, run this in a shell (`/plugin update` is not
a command inside a session):

```
claude plugin marketplace update onebox
claude plugin update <plugin>@onebox
```

Then type `/reload-plugins` in your Claude Code session, or restart it. The
`/plugin` screen can do the same. In Codex:

```
codex plugin marketplace upgrade onebox
codex plugin add <plugin>@onebox
```

A plugin updates only when its version went up.
[CHANGELOG.md](CHANGELOG.md) says what changed in each version.

## The road to the App Store

1. **Apple:** join the Apple Developer Program ($99 a year) and install Xcode.
2. **TestFlight:** build on your own Mac, for free, and upload
   (`ship-ios:expo-local-build`, `ship-ios:appstore-connect`).
3. **Your phone:** a test build on your own iPhone, without TestFlight
   (`ship-ios:ios-preview-build`).
4. **Store page:** the icon, screenshots from real screens, and text that
   search finds (`ship-ios:draw-app-icon`, `ship-ios:app-store-screenshots`,
   `ship-ios:store-listing`).
5. **App Review:** find what Apple will reject before Apple does, then submit
   (`ship-ios:app-store-ready`, `ship-ios:appstore-connect`).
6. **Updates:** a JavaScript fix without App Review, and every version after
   the first (`ship-ios:eas-update`).

Every skill runs in your coding agent on your Mac. A server is optional. If
the app needs one, the `box` skills set it up on one machine over SSH.

## What is in the box

14 skills in 4 plugins, and 31 guides. Install the `start` plugin first. It
tells you which of the others you need.

| Plugin | Runs on | What it does | Skills |
|---|---|---|---|
| `start` | your Mac | Makes the repo, writes your plan, and says what is next | plan, new-app |
| `ship-ios` | your Mac | From a working app to TestFlight and the store | app-store-ready, expo-local-build, eas-update, appstore-connect, ios-preview-build, app-store-screenshots, store-listing, draw-app-icon |
| `box` | your server | A safe, small server for the API and the site | box-setup, expose-service, new-landing-page |
| `dev` | your Mac | Makes the agent prove its work before it says "done" | test-loop |

## How it works

- **Guides are the source of truth.** Each account, key or topic has one plain
  page in [guides/](guides/). Skills follow the guides and add only the files
  no guide has. Start with [guides/start-here.md](guides/start-here.md).
- **The plan reads your repo.** `/start:plan` looks at what the app already
  has, asks only what it cannot see, and ticks what is done.
- **Nothing personal inside a skill.** Your Apple team, box host, domain and
  secrets tool live in `~/.config/onebox/config.json`, and an optional
  `.onebox.json` per app. Secrets are never stored there, only references.
  See [CONFIG.md](CONFIG.md).
- **Cheap first.** Local builds before paid cloud builds. One box before many.

## How well tested is it

I have shipped three iOS apps with this, and got each one through App Review.
Getting people to download them is a different skill, and not one I have, so
the kit does not teach marketing. I keep testing it on new apps. The
latest runs built a new app from an empty folder with the skills and guides.
Every problem they found became an issue and a fix. The three layouts (.NET
API, Node API, no server) each ran end to end in the iOS Simulator.

Not tested yet: a clean Mac with nothing installed, and a person who is new to
all of it. [docs/clean-user-test.md](docs/clean-user-test.md) is the script
for that. If you try it, tell me where you got stuck.

## Contributing and problems

A skill or guide wrong or unclear? [Open an issue](https://github.com/ggi3201/onebox/issues/new?template=dogfood.md).
Write "the app" or `myapp`, never a real name, host or account.

Writing a skill? Read [CONTRIBUTING.md](CONTRIBUTING.md) first. It is short.
Security problems: see [SECURITY.md](SECURITY.md). Everyone here follows the
[code of conduct](CODE_OF_CONDUCT.md).

## Also good

Skills by other people that work well next to these. Each has its own
install steps and license.

- [ponytail](https://github.com/DietrichGebert/ponytail): stops the agent from
  overbuilding.
- [impeccable](https://github.com/pbakaus/impeccable): design audits and polish
  for a landing page or app UI.
- [taste-skill](https://github.com/Leonxlnx/taste-skill): pushes UI away from the
  generic AI look.
- [emil-design-eng](https://github.com/emilkowalski/skills): motion, timing and
  polish.
- [RevenueCat ai-toolkit](https://github.com/RevenueCat/ai-toolkit): SDK setup
  and paywalls. `claude plugins marketplace add RevenueCat/ai-toolkit`.
- [frontend-design](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/frontend-design):
  Anthropic's plugin. `/plugin install frontend-design@claude-plugins-official`.

## License

MIT. See [LICENSE](LICENSE).

Not affiliated with Apple, Expo or the other companies named here. Names and
trademarks belong to their owners.
