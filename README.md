# onebox

Ship your app from one box.

Claude Code skills and plain guides for getting an Expo / React Native app onto
the App Store, with the backend on one cheap server: a mini PC at home or a
small VPS. No AWS, no Kubernetes.

Site and guides: https://onebox.lokkesveen.com · For agents: https://onebox.lokkesveen.com/llms.txt

## Install

In Claude Code:

```
/plugin marketplace add ggi3201/onebox
/plugin install ship-ios@onebox
```

Other tools (Codex, Cursor and more):

```
npx skills add ggi3201/onebox
```

## What is in the box

| Plugin | Runs on | Skills |
|---|---|---|
| `ship-ios` | your Mac | app-store-ready, expo-local-build, appstore-connect, ios-preview-build, app-store-screenshots, draw-app-icon, draw-icon-set |
| `box` | your server | box-setup, expose-service, new-landing-page, staging-env |
| `content` | your Mac | transcribe, image |

## Setup

Skills read your values (Apple team, box host, domain, secrets tool) from
`~/.config/onebox/config.json` and an optional `.onebox.json` per app. Nothing
personal lives inside a skill. See [CONFIG.md](CONFIG.md).

Accounts and keys a skill cannot create for you are in [guides/](guides/).
Start with [guides/start-here.md](guides/start-here.md).

## Also good

RevenueCat's own plugin covers SDK setup and paywalls:
`claude plugins marketplace add RevenueCat/ai-toolkit`.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for third-party code.
