// The packing list is read from the repo, so the site never lists a skill
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
    blurb: "Reels into text an LLM can use. Images without the stock-photo look.",
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
  "transcribe": "Timestamped text from a reel, a TikTok or a voice memo. Free and local.",
  "image": "Generate and edit images with kie.ai, fal or Replicate. Look first, pay little, reroll.",
  "video": "Animate an approved still. Chain shots so the cuts disappear.",
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
