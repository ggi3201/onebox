// The box contents are read from the repo, so the site never lists a skill
// that does not exist. Short taglines live here; a skill without one falls
// back to the first sentence of its description.

export const REPO = "https://github.com/ggi3201/onebox";
export const REPO_SLUG = "ggi3201/onebox";

type Plugin = { id: string; letter: string; title: string; runsOn: string; blurb: string };

export const PLUGINS: Plugin[] = [
  {
    id: "ship-ios",
    letter: "A",
    title: "Ship iOS",
    runsOn: "Your Mac",
    blurb: "From “works on my phone” to TestFlight and App Review.",
  },
  {
    id: "box",
    letter: "B",
    title: "Box",
    runsOn: "Your server",
    blurb: "Backend and sites on one cheap machine. A mini PC at home or a small VPS.",
  },
  {
    id: "content",
    letter: "C",
    title: "Content",
    runsOn: "Your Mac",
    blurb: "Images and video for the store page, the landing page and social posts.",
  },
  {
    id: "dev",
    letter: "D",
    title: "Dev loop",
    runsOn: "Your Mac",
    blurb: "The agent proves its change on the simulator before it says done.",
  },
  {
    id: "app-features",
    letter: "E",
    title: "App features",
    runsOn: "Your app",
    blurb: "An AI chat and agent, cost limits, consent, background jobs and share import, built into your app and API.",
  },
];

const TAGLINES: Record<string, string> = {
  "app-store-ready": "Tells you why Apple will reject your app, before Apple does.",
  "expo-local-build": "Builds on your own Mac and sends it to TestFlight. No build credits.",
  "appstore-connect": "TestFlight builds, testers, groups and subscriptions from the terminal.",
  "ios-preview-build": "A build for your real phone that talks to staging, not production.",
  "app-store-screenshots": "Store images from your real screens, in your app’s own fonts.",
  "draw-app-icon": "A vector icon that still reads at home-screen size.",
  "draw-icon-set": "A set of outline icons that look like one family.",
  "box-setup": "Takes a fresh VPS to a safe, working baseline in one go.",
  "expose-service": "Puts a service on the internet at your domain, with no open ports.",
  "new-landing-page": "A self-hosted landing page, or your Next.js site moved off Vercel.",
  "staging-env": "A second backend for test branches, with its own database.",
  "image": "Generate and edit images with kie.ai, fal or Replicate. Look first, pay little, reroll.",
  "video": "Animate an approved still. Chain shots so the cuts disappear.",
  "test-loop": "Lint, types, tests, then the simulator. Proof before “done”.",
  "trim-tests": "Cuts a fifth of your tests and keeps what catches bugs.",
  "agent-harness": "An agent in your API that calls your tools, streams, and proposes instead of acting.",
  "chat-feature": "A chat screen that streams word by word, with Stop, photos and tap-to-apply cards.",
  "ai-usage-limits": "A monthly budget per user, so one account cannot run up your model bill.",
  "ai-consent": "The AI consent step App Review asks for, enforced on the server too.",
  "durable-jobs": "Slow work as a background job that survives restarts, with cancel and refunds.",
  "share-import": "Share a page into your app and get a record back, without the model making things up.",
};

export type Skill = { name: string; plugin: string; line: string };

const files = import.meta.glob("../../../plugins/*/skills/*/SKILL.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function firstSentence(md: string): string {
  const d = md.match(/^description:\s*(?:>-?|\|)?\s*([\s\S]*?)\n[a-z-]+:/m)?.[1] ?? "";
  const flat = d.replace(/\s+/g, " ").replace(/^["']|["']$/g, "").trim();
  return flat.split(/(?<=\.)\s/)[0] ?? flat;
}

export const SKILLS: Skill[] = Object.entries(files)
  .map(([path, md]) => {
    const [, plugin, name] = path.match(/plugins\/([^/]+)\/skills\/([^/]+)\//)!;
    return { name, plugin, line: TAGLINES[name] ?? firstSentence(md) };
  })
  .sort((a, b) => {
    const order = Object.keys(TAGLINES);
    const ia = order.indexOf(a.name), ib = order.indexOf(b.name);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name);
  });

export const skillsFor = (plugin: string) => SKILLS.filter((s) => s.plugin === plugin);

// Apps shipped with this setup. Proof, not decoration.
export const APPS = [
  { name: "Foodie", what: "Recipes from any reel, turned into a cook mode.", status: "On the App Store", url: "https://apps.apple.com/app/id6757007757" },
  { name: "Thraed", what: "A digital closet with AI outfit help.", status: "On the App Store", url: "https://apps.apple.com/us/app/thraed/id6757984436" },
  { name: "Chewable", what: "The first one. A fitness app, 2019 onwards.", status: "On the App Store", url: "https://apps.apple.com/app/chewablefit/id6740989274" },
  { name: "Lift", what: "A strength log that feels native. Built in eight days.", status: "In TestFlight", url: null },
];

// Paid services a first app can skip. Prices checked on 2026-09-28.
// `cost` feeds the total: one typical plan per row, not every example added up.
export const SKIPPABLE = [
  { what: "An App Store upload service", example: "Lance Pro, $40/mo", cost: 40, instead: "ship-ios skills on your Mac" },
  { what: "A hosting platform", example: "Vercel Pro, $20/mo", cost: 20, instead: "the box, or Cloudflare Pages for a static site" },
  { what: "A managed database", example: "Supabase Pro or Convex Pro, $25/mo; PlanetScale Postgres from $5/mo", cost: 25, instead: "Postgres on the box" },
  { what: "A cloud build plan", example: "EAS Starter, $19/mo", cost: 19, instead: "local builds on your Mac" },
];

// Skills by other people that work well next to these. Links only; each has its own licence.
export const OTHERS = [
  { name: "ponytail", by: "Dietrich Gebert", url: "https://github.com/DietrichGebert/ponytail", line: "Stops the agent from overbuilding. The simplest code that works, with safety kept." },
  { name: "impeccable", by: "Paul Bakaus", url: "https://github.com/pbakaus/impeccable", line: "Design vocabulary, audits and polish for a landing page or app UI." },
  { name: "taste-skill", by: "Leonxlnx", url: "https://github.com/Leonxlnx/taste-skill", line: "Pushes UI away from the generic AI look. Includes a redesign skill for an existing site." },
  { name: "emil-design-eng", by: "Emil Kowalski", url: "https://github.com/emilkowalski/skills", line: "Small details that make an interface feel good: motion, timing, polish." },
  { name: "RevenueCat ai-toolkit", by: "RevenueCat", url: "https://github.com/RevenueCat/ai-toolkit", line: "RevenueCat's own plugin for the SDK, offerings and the paywall." },
  { name: "frontend-design", by: "Anthropic", url: "https://github.com/anthropics/claude-plugins-official/tree/main/plugins/frontend-design", line: "The official plugin for distinctive frontends. /plugin install frontend-design@claude-plugins-official" },
];
