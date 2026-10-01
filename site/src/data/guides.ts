// Guides are the markdown files in ../guides. The order is the order a
// newcomer needs them; files not listed here come last, alphabetically.

const ORDER = [
  "start-here",
  "apple-developer",
  "xcode",
  "tools",
  "expo-app",
  "agent-test-loop",
  "secrets",
  "domain",
  "cloudflare",
  "vps",
  "remote-access",
  "uptime-alerts",
  "backend",
  "hosted-backend",
  "sign-in-with-apple",
  "revenuecat",
  "push-notifications",
  "ask-for-a-rating",
  "app-store-connect-setup",
  "app-store-connect-api-key",
  "expo-eas",
  "privacy-and-support-pages",
  "kie-ai",
  "media-providers",
  "llm-api-key",
  "langfuse",
  "crash-reports",
  "ship-an-update",
  "when-you-are-stuck",
  "glossary",
];

type MdModule = {
  Content: any;
  frontmatter: Record<string, any>;
  getHeadings: () => { depth: number; slug: string; text: string }[];
};

const modules = import.meta.glob("../../../guides/*.md", { eager: true }) as Record<string, MdModule>;

const raw = import.meta.glob("../../../guides/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const slugOf = (path: string) => path.split("/").pop()!.replace(/\.md$/, "");

export const RAW: Record<string, string> = Object.fromEntries(Object.entries(raw).map(([p, s]) => [slugOf(p), s]));

// Raw markdown is read outside the site (pasted into a chat), so relative
// links must become absolute: other guides -> their .md URL, repo files -> GitHub.
export function absolutize(md: string, site: URL | undefined): string {
  const base = site?.origin ?? "";
  return md.replace(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g, (_, url: string) => {
    const guide = url.match(/^(?:\.\/)?([a-z0-9-]+)\.md(#.*)?$/);
    if (guide) return `](${base}/guides/${guide[1]}.md${guide[2] ?? ""})`;
    if (url.startsWith("../")) return `](https://github.com/ggi3201/onebox/blob/main/${url.slice(3)})`;
    return `](${url})`;
  });
}

export type Guide = { slug: string; title: string; module: MdModule; n: number };

export const GUIDES: Guide[] = Object.entries(modules)
  .map(([path, module]) => {
    const slug = slugOf(path);
    const h1 = module.getHeadings().find((h) => h.depth === 1)?.text;
    return { slug, title: module.frontmatter.title ?? h1 ?? slug, module, n: 0 };
  })
  .sort((a, b) => {
    const ia = ORDER.indexOf(a.slug), ib = ORDER.indexOf(b.slug);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.slug.localeCompare(b.slug);
  })
  .map((g, i) => ({ ...g, n: i }));
