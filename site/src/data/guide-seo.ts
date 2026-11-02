// The <title> and meta description of each guide, written for search results.
// The guides stay plain markdown (no frontmatter), so they read well on GitHub.
//
// Title: about 50 to 60 characters, the phrase people search for first. The
// site adds " — onebox" when the whole title still fits in 60 characters.
// Description: 140 to 160 characters, and only what the guide really covers.
// A new guide needs an entry here; the build stops without one.

export type GuideSeo = { title: string; description: string };

const BRAND = " — onebox";
const MAX_TITLE = 60;

export const GUIDE_SEO: Record<string, GuideSeo> = {
  "start-here": {
    title: "Expo App to App Store: Start Here Roadmap for Beginners",
    description:
      "A map from an AI-built Expo app to the App Store: accounts, local builds, TestFlight, App Review and updates, with what each phase costs and a checklist.",
  },
  "apple-developer": {
    title: "Apple Developer Program: Cost, Enrollment, Account Type",
    description:
      "The Apple Developer Program costs 99 USD a year. See how to enroll, whether to join as an individual or organization, why enrollment stalls, and your Team ID.",
  },
  xcode: {
    title: "Xcode Download and Install for Expo: Version, Disk Space",
    description:
      "Install Xcode on your Mac for Expo iOS builds. See which Xcode your Expo SDK needs, how much disk space to keep free, and the setup steps with common fixes.",
  },
  tools: {
    title: "Command-Line Tools for Expo iOS Builds: Node, EAS, Fastlane",
    description:
      "Every command-line tool the onebox skills use, which skill needs it and how to install it: Xcode, Node, pnpm, eas, CocoaPods, fastlane, Docker and more.",
  },
  "expo-app": {
    title: "Expo App Setup for iOS: Bundle ID, eas.json, Dev Build",
    description:
      "Get an Expo project ready for the App Store: a fixed bundle ID, an API URL per build profile, a development build, three eas.json profiles and version numbers.",
  },
  "agent-test-loop": {
    title: "Test Loop for AI Coding Agents: Types, Tests, Simulator",
    description:
      "Give your coding agent checks it can run: strict types, a linter, unit tests, real-database tests, a seeded dev database and simulator scripts in AGENTS.md.",
  },
  secrets: {
    title: "Secrets for Your App and AI Agent: 1Password and Doppler",
    description:
      "Keep app and agent secrets out of git and chat. Pick a tool, then let your coding agent read a secret without seeing other passwords. 1Password and Doppler.",
  },
  domain: {
    title: "Buy a Domain for Your App: Cheap Registrars and TLDs",
    description:
      "Pick a registrar and a TLD that stay cheap at renewal, with prices checked in September 2026. One domain serves your API, landing page and privacy URLs.",
  },
  cloudflare: {
    title: "Cloudflare Tunnel and DNS for Your Server: Free Plan",
    description:
      "Move your domain's DNS to Cloudflare, make a DNS API token, open a Cloudflare Tunnel with no open ports, and put admin tools behind Cloudflare Access.",
  },
  vps: {
    title: "Small VPS for Your App Backend: Hetzner Size and Setup",
    description:
      "Rent a small Ubuntu VPS for your backend. Pick a size, check the Hetzner price, make an SSH key, create the server with hcloud and add a firewall.",
  },
  backend: {
    title: "Self-Hosted App Backend: Docker Compose, Postgres, API",
    description:
      "Run your API and Postgres in Docker Compose on your own server, with HTTPS and GitHub Actions deploys. Covers per-user data rules, rate limits and AI quotas.",
  },
  "hosted-backend": {
    title: "Supabase vs Convex vs Firebase for an Expo App Backend",
    description:
      "Compare Supabase, Convex and Firebase for an Expo app: free tiers, prices, Sign in with Apple, user data rules, secret AI calls, and when your own server wins.",
  },
  "sign-in-with-apple": {
    title: "Sign in with Apple in Expo: Server Check, Account Deletion",
    description:
      "Add Sign in with Apple to an Expo app, verify Apple's token on your server, and build the account deletion with token revocation that App Review checks.",
  },
  revenuecat: {
    title: "RevenueCat for Expo: iOS Subscriptions, Paywall, Pricing",
    description:
      "Set up RevenueCat for iOS subscriptions in an Expo app: purchase key, products, entitlement, offering and SDK key. Plus paywall tips, sandbox tests and cost.",
  },
  "push-notifications": {
    title: "Expo Push Notifications for iOS: APNs Key, Tokens, Sending",
    description:
      "Set up push notifications in an Expo app: make the APNs key, ask permission at the right time, store device tokens, send with Expo Push and handle taps.",
  },
  "share-links": {
    title: "Universal Links and Share Extension for Expo Apps",
    description:
      "Add share links to an Expo app: universal links that open the app, a preview card in iMessage and WhatsApp, and a share extension to send links into your app.",
  },
  "live-activities": {
    title: "Live Activities in Expo: Lock Screen and Dynamic Island",
    description:
      "Add an iOS Live Activity to an Expo app with a Swift widget extension and the react-native-widget-extension plugin. Start it from JavaScript and avoid mistakes.",
  },
  "ask-for-a-rating": {
    title: "Ask for an App Store Rating in Expo: expo-store-review",
    description:
      "Add the iOS rating prompt with expo-store-review at a good moment, follow Apple's limit of three prompts a year, and add a Rate the app row to settings.",
  },
  "app-store-connect-setup": {
    title: "App Store Connect Setup: Bundle ID, App Record, TestFlight",
    description:
      "The one-time App Store Connect setup in a browser: register the bundle ID, create the app record, sign agreements, add TestFlight testers, export compliance.",
  },
  "app-store-connect-api-key": {
    title: "Create an App Store Connect API Key (.p8, Key ID, Issuer ID)",
    description:
      "Make an App Store Connect API key, download the .p8 file once, find the Key ID and Issuer ID, pick a role, and fix the Apple 401 error in EAS builds.",
  },
  "expo-eas": {
    title: "What Is Expo EAS? Account, CLI Login and Build Setup",
    description:
      "EAS is Expo Application Services. Make a free Expo account, install the eas CLI, run eas login, link your project, and compare local and cloud builds.",
  },
  "privacy-and-support-pages": {
    title: "Privacy Policy and Support Page for an App Store App",
    description:
      "Apple needs a public privacy policy and support page for every app. Host both free on GitHub Pages in about half an hour, with wording for account deletion.",
  },
  "submit-for-review": {
    title: "Submit Your App for App Review: Steps, Wait Time, Rejections",
    description:
      "Fill in the App Store Connect version page field by field, submit, learn what each review status means, how long review takes, and what to do after a rejection.",
  },
  "llm-api-key": {
    title: "LLM API Key for Your App: OpenRouter, OpenAI, Gemini",
    description:
      "Pick a model provider, make an API key and keep it on your server, never in the app. Compares OpenRouter, OpenAI, Gemini and Anthropic, and per-token billing.",
  },
  "ai-consent": {
    title: "App Store AI Consent: Guideline 5.1.2(i) Prompt Example",
    description:
      "Apple wants clear permission before an app shares personal data with a third-party AI. What App Review checks, plus a sample prompt, server check and opt-out.",
  },
  "hosted-ai-limits": {
    title: "AI Cost Limits for a Supabase Backend: Quotas and Budget",
    description:
      "Cap your AI bill on a hosted backend: an atomic per-user daily count, request limits, an app-wide budget in the database, and your provider's spend limit.",
  },
  "crash-reports": {
    title: "Crash Reports for iOS Apps: Xcode Organizer and Sentry",
    description:
      "See why your app crashes after launch: free Xcode Organizer and TestFlight reports, Sentry for JavaScript errors with readable traces, and API error reports.",
  },
  "product-analytics": {
    title: "PostHog for Expo: Product Analytics, Events, Opt-In",
    description:
      "Add PostHog to an Expo app with a few named events, an opt-in prompt and optional session replay, plus the privacy policy and App Privacy changes it needs.",
  },
  "ship-an-update": {
    title: "Ship an App Update: EAS Update or New Build, Phased Release",
    description:
      "Release version 1.1 or a quick fix: pick an EAS Update or a new build, raise the version, update the backend safely, test on staging, release in phases.",
  },
  "when-you-are-stuck": {
    title: "Stuck on an App Build or Rejection? Debug with Your Agent",
    description:
      "What to collect before you ask for help: the full error, the command, Apple's exact message. Then the right skill, a prompt that works, and when to ask a human.",
  },
  glossary: {
    title: "App Store and Expo Glossary: Bundle ID, EAS, TestFlight",
    description:
      "Plain meanings of words in the onebox guides: Apple Developer Program, Team ID, bundle ID, TestFlight, EAS, the box, Cloudflare Tunnel and more, with links.",
  },
};

// The title for <title>: the guide's own, plus the brand when it fits.
export function seoFor(slug: string): GuideSeo & { fullTitle: string } {
  const seo = GUIDE_SEO[slug];
  if (!seo) throw new Error(`guides/${slug}.md has no entry in site/src/data/guide-seo.ts. Add a title and a description.`);
  const withBrand = seo.title + BRAND;
  return { ...seo, fullTitle: withBrand.length <= MAX_TITLE ? withBrand : seo.title };
}
