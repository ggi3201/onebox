<div align="center">

# onebox

**Get your app on the App Store.**

Agent skills and plain guides that take an Expo / React Native app from idea to
the App Store. If the app needs a backend, it runs on one cheap box.
No AWS. No Kubernetes.

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
  road in one place: signing, TestFlight, App Review, an API, a landing page.
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

Then open Claude Code in an empty folder and describe your idea. Or run
`/start:new-app` to make the repo, and `/start:plan` later to see what is done
and what is next. Run `/start:plan` again after each step. It ticks what you
finished.

Other agents (Codex, Cursor, Gemini CLI and more):

```
npx skills add ggi3201/onebox
```

The skills are plain `SKILL.md` files, so any agent that reads them can use
them. I build and test with Claude Code.

To get fixes later:

```
/plugin marketplace update onebox
/plugin update <plugin>@onebox
```

Then restart Claude Code. A plugin updates only when its version went up.
[CHANGELOG.md](CHANGELOG.md) says what changed in each version.

## The route

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/route-dark.png">
  <img alt="How onebox fits together: your Mac runs your coding agent and every skill, builds the app and submits it to Apple, which delivers it to phones. Phones call your API through a Cloudflare tunnel into one box that runs the API, Postgres, staging, backups, Traefik and the landing page with pricing, privacy policy, support and terms. App Store Connect links to that landing page." src="docs/route-light.png">
</picture>

Every skill runs in your coding agent on your Mac. The `box` skills reach your
server over SSH. The landing page on the box holds the privacy policy, support
and terms pages that App Store Connect and your paywall link to.

## What is in the box

25 skills in 6 plugins, and 28 guides. Install the `start` plugin first. It
tells you which of the others you need.

| Plugin | Runs on | What it does | Skills |
|---|---|---|---|
| `start` | your Mac | Makes the repo, writes your plan, and says what is next | plan, new-app |
| `ship-ios` | your Mac | From a working app to TestFlight and the store | app-store-ready, expo-local-build, eas-update, appstore-connect, ios-preview-build, app-store-screenshots, store-listing, draw-app-icon, draw-icon-set |
| `box` | your server | A safe, small server for the API and the site | box-setup, expose-service, new-landing-page, staging-env |
| `dev` | your Mac | Makes the agent prove its work before it says "done" | test-loop, trim-tests |
| `app-features` | your app and API | AI features, built with limits and consent | agent-harness, chat-feature, ai-usage-limits, ai-consent, durable-jobs, share-import |
| `content` | your Mac | Images and video for the store page and social | image, video |

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

onebox comes from shipping real apps, and I keep testing it on new ones. The
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
Security problems: see [SECURITY.md](SECURITY.md).

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

MIT. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for third-party code.

Not affiliated with Apple, Expo or the other companies named here. Names and
trademarks belong to their owners.
