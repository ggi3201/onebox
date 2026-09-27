// llms.txt: a plain index for agents. Links point at the raw markdown.
import type { APIRoute } from "astro";
import { GUIDES } from "../data/guides";
import { PLUGINS, SKILLS, REPO, REPO_SLUG } from "../data/kit";

export const GET: APIRoute = ({ site }) => {
  const base = site!.origin;
  const lines = [
    "# onebox",
    "",
    "> Free Claude Code skills and plain guides for getting an Expo / React Native app onto the App Store, with the backend on one cheap server (a mini PC at home or a small VPS). MIT licensed.",
    "",
    `Install in Claude Code: \`/plugin marketplace add ${REPO_SLUG}\`, then \`/plugin install <plugin>@onebox\`. Other tools: \`npx skills add ${REPO_SLUG}\`. Source: ${REPO}`,
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
    "## Optional",
    "",
    `- [All guides in one file](${base}/llms-full.txt)`,
    `- [Config contract](${REPO}/blob/main/CONFIG.md)`,
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
