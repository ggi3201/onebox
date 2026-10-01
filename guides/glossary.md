# Words you will meet

Runs on: your browser. Nothing to set up.

The guides and skills use these words. Each one gets one or two plain
sentences. When a word has its own guide, the entry links to it.

## Apple

- **Apple Developer Program.** The $99 a year membership you need to put an
  app on the App Store. See [apple-developer.md](apple-developer.md).
- **Apple Account.** Your Apple login. Apple used to call it the Apple ID.
- **Team ID.** A 10-character code for your developer account. Builds,
  keys and Sign in with Apple all use it.
- **Bundle identifier (bundle ID).** The app's unique name at Apple, for
  example `com.example.myapp`. You cannot change it after the first upload.
- **App ID.** The bundle ID registered with Apple, plus the features it may
  use, such as Sign in with Apple.
- **Capability.** A feature the app must ask Apple for, such as Sign in with
  Apple or push notifications. It is switched on for the App ID.
- **Certificate and provisioning profile.** Files that prove a build comes
  from you and may run on certain phones. EAS makes and stores them for you.
- **App Store Connect.** Apple's website for your apps: the app record,
  builds, testers, prices, the store page and review. See
  [app-store-connect-setup.md](app-store-connect-setup.md).
- **App record.** Your app's entry in App Store Connect. You make it once, by
  hand, before the first upload.
- **App Store Connect API key.** A key that lets a script or a skill work in
  App Store Connect without your password. See
  [app-store-connect-api-key.md](app-store-connect-api-key.md).
- **TestFlight.** Apple's app for test builds. Testers install your build
  before it is on the App Store.
- **App Review.** The check Apple runs before an app or an update goes live.
  It can take hours or days, and it can reject the app with a guideline
  number.
- **Phased release.** An update that reaches users with automatic updates
  over seven days, from 1% to 100%. You can pause it. See
  [ship-an-update.md](ship-an-update.md).
- **Version and build number.** The version (`1.2.0`) is what users see. The
  build number must go up with every upload, even for the same version.
- **App Privacy.** Your answers in App Store Connect about the data the app
  collects. They show on the store page and must match your privacy policy.
- **Privacy manifest.** A file inside the app that lists the data it
  collects and the system features it uses for that. Uploads without one can
  fail.
- **Export compliance.** Apple's question about encryption. Most apps answer
  it once in the app config.
- **Paid Apps agreement.** The contract, tax and bank details you must finish
  in App Store Connect before you can sell anything.

## Expo and the app

- **Expo.** The toolkit most React Native apps are built with. See
  [expo-app.md](expo-app.md).
- **EAS.** Expo Application Services: EAS Build makes the app, EAS Submit
  uploads it to Apple. See [expo-eas.md](expo-eas.md).
- **Local build.** An EAS build that runs on your own Mac with
  `eas build --local`. It is free and uses no build credits.
- **Build profile.** A named set of build settings in `eas.json`, usually
  `development`, `preview` and `production`.
- **Expo Go and development build.** Expo Go is a ready-made app that runs
  your code, but only with the native modules it ships with. A development
  build is your own app with your own native modules. Real apps need the
  second one.
- **Native rebuild.** A new build of the app itself, needed after you add a
  native module or change the app config. A JavaScript change does not need
  one.
- **EAS Update.** New JavaScript for a build that is already on phones,
  without App Review. It cannot change native code. The skill is
  `ship-ios:eas-update`.
- **Runtime version.** A label that says which native build an EAS Update
  fits. An update reaches only builds with the same runtime version.
- **Metro.** The server on your Mac that sends your JavaScript to the app
  while you develop.
- **Simulator.** An iPhone that runs on your Mac, part of Xcode. See
  [xcode.md](xcode.md).
- **Preview build (ad hoc).** A build that installs straight onto a few
  phones you registered, without TestFlight.
- **`EXPO_PUBLIC_*`.** Settings built into the app, such as the API URL.
  Anyone can read them, so they are never secret.

## The box and the web

- **The box.** The one machine that runs your backend: a mini PC at home or
  a small VPS.
- **VPS.** A virtual private server: a small computer you rent in a data
  centre. See [vps.md](vps.md).
- **SSH and SSH key.** SSH is how your Mac logs in to the box. The key is a
  file that replaces a password.
- **Docker and Compose.** Docker runs each service in its own container.
  Compose starts a group of containers from one file.
- **Traefik.** The program on the box that sends each hostname to the right
  container.
- **DNS record.** An entry that tells the internet where a name like
  `api.example.com` goes. A CNAME points at another name. An A record points
  at an IP address.
- **Cloudflare Tunnel.** A connection from the box out to Cloudflare. Visitors
  reach the box through it, so the box needs no open ports. See
  [cloudflare.md](cloudflare.md).
- **Proxied.** A DNS record that goes through Cloudflare, so the box's real
  address stays hidden.
- **Tailscale.** A private network for your own devices, so you can reach the
  box from your phone anywhere. See [remote-access.md](remote-access.md).
- **API.** Your backend: the code the app calls over HTTPS. See
  [backend.md](backend.md).
- **Postgres.** The database the backend uses.
- **Migration.** A step that changes the database structure, such as adding a
  column. It runs in order, once.
- **Staging.** A second copy of the backend, with its own database, for
  testing a change before users see it.
- **Backup.** A copy of the database kept off the box. It only counts when you
  have restored one once.
- **Landing page.** The app's website. It holds the privacy policy and the
  support page Apple asks for. See
  [privacy-and-support-pages.md](privacy-and-support-pages.md).

## Money

- **RevenueCat.** A service that handles subscriptions and purchases for you.
  See [revenuecat.md](revenuecat.md).
- **Offering and entitlement.** In RevenueCat, an offering is what the
  paywall shows. An entitlement is what the user gets after paying, such as
  "pro".
- **Paywall.** The screen that asks the user to pay.

## Secrets and AI

- **Secret.** Anything that grants access or costs money, such as an API key
  or a password. See [secrets.md](secrets.md).
- **Reference.** A pointer to a secret, such as `KIE_AI_API_KEY` or
  `op://agent-secrets/kie/credential`, instead of the secret itself.
- **Service account.** A login for a program, not a person. It can read only
  what you give it.
- **LLM API key.** The key your backend uses to call an AI model. See
  [llm-api-key.md](llm-api-key.md).

## The kit

- **Coding agent.** The AI tool that works in your code, such as Claude Code,
  Codex or Cursor.
- **Skill.** A set of instructions your agent follows for one job, such as
  `ship-ios:app-store-ready`. It is a plain `SKILL.md` file.
- **Plugin.** A group of skills you install together in Claude Code, such as
  `ship-ios`.
- **Marketplace.** A list of plugins you add to Claude Code once, such as
  `onebox`.
- **PLAN.md.** The checklist the plan skill writes for your app.
  [See an example](https://onebox.lokkesveen.com/example-plan/).
- **The onebox config.** `~/.config/onebox/config.json`, plus an optional
  `.onebox.json` in each project. It holds settings and secret references,
  never secret values.
