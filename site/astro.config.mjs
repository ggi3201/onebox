import { defineConfig } from "astro/config";
import { unified } from "@astrojs/markdown-remark";

const REPO = "https://github.com/ggi3201/onebox";

// Guides are plain markdown in ../guides so they read well on GitHub too.
// On the site, rewrite their relative links: `xcode.md` -> `/guides/xcode/`,
// anything else relative (../plugins/..., ../CONFIG.md) -> the file on GitHub.
function rewriteGuideLinks() {
  const walk = (node) => {
    if (node.type === "link" && typeof node.url === "string") {
      const guide = node.url.match(/^(?:\.\/)?([a-z0-9-]+)\.md(#.*)?$/);
      if (guide) node.url = `/guides/${guide[1]}/${guide[2] ?? ""}`;
      else if (node.url.startsWith("../")) node.url = `${REPO}/blob/main/${node.url.slice(3)}`;
    }
    node.children?.forEach(walk);
  };
  return () => walk;
}

export default defineConfig({
  site: "https://onebox.lokkesveen.com",
  markdown: {
    processor: unified({ remarkPlugins: [rewriteGuideLinks()] }),
    shikiConfig: { theme: "css-variables" },
  },
  vite: {
    server: { fs: { allow: [".."] } },
  },
});
