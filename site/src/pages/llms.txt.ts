// llms.txt: a plain index for agents. Links point at the raw markdown.
import type { APIRoute } from "astro";
import { GUIDES } from "../data/guides";
import { PLUGINS, SKILLS, REPO, REPO_SLUG, OTHERS } from "../data/kit";

export const GET: APIRoute = ({ site }) => {
  const base = site!.origin;
  const lines = [
    "# onebox",
    "",
    "> Free agent skills (SKILL.md, for Claude Code, Codex, Cursor, Gemini CLI and others) and plain guides for getting an Expo / React Native app onto the App Store. If the app needs a backend, it runs on one cheap server (a mini PC at home or a small VPS). MIT licensed.",
    "",
    `Install in Claude Code: \`/plugin marketplace add ${REPO_SLUG}\`, then \`/plugin install <plugin>@onebox\`. Other tools: \`npx skills add ${REPO_SLUG}\`. Source: ${REPO}`,
    "",
    "Start here: install the `start` plugin, then run `/start:plan` in the app's folder (in other agents, ask for the plan skill). It detects what the app already has, asks what the user wants (server or not, sign-in, paid or free, landing page, AI), and writes PLAN.md with only the guides, skills and plugins that app needs.",
    "",
    "## How it fits together",
    "",
    "- Your Mac runs the coding agent and every skill. It builds the app locally and submits it to Apple (App Store Connect, TestFlight, App Review).",
    "- Phones get the app from TestFlight or the App Store and call your API over HTTPS at api.<your domain>.",
    "- Cloudflare holds DNS and a tunnel, the only way into the box. No open ports.",
    "- The box (a mini PC at home or a small VPS) runs Docker: Traefik, the API, Postgres, a staging API and database, nightly backups, and the landing page.",
    "- The landing page holds pricing, privacy policy, support and terms. App Store Connect and the paywall link to it.",
    "- Your Mac sets up the box over SSH; a git push deploys. RevenueCat (optional) sends webhooks to the API.",
    "- The box needs about 15 minutes of care a month (updates, the box check, backups), which an agent can do. It is one point of failure: bigger apps, sensitive data or a team need a larger setup.",
    "",
    "## Guides",
    "",
    ...GUIDES.map((g) => `- [${g.title}](${base}/guides/${g.slug}.md)`),
    "",
    "## Skills",
    "",
    ...PLUGINS.flatMap((p) => [
      `### ${p.id} (runs on: ${p.runsOn.toLowerCase()})`,
      "",
      ...SKILLS.filter((s) => s.plugin === p.id).map(
        (s) => `- [${p.id}:${s.name}](${REPO}/blob/main/plugins/${p.id}/skills/${s.name}/SKILL.md): ${s.line}`,
      ),
      "",
    ]),
    "## Skills by others that work well next to these",
    "",
    ...OTHERS.map((o) => `- [${o.name}](${o.url}) by ${o.by}: ${o.line}`),
    "",
    "## Optional",
    "",
    `- [All guides in one file](${base}/llms-full.txt)`,
    `- [Config contract](${REPO}/blob/main/CONFIG.md)`,
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
