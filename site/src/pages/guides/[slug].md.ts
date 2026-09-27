// Every guide is also served as raw markdown at /guides/<slug>.md, so a
// person can paste the URL into Claude and get the text without the page.
import type { APIRoute } from "astro";
import { RAW, GUIDES, absolutize } from "../../data/guides";

export function getStaticPaths() {
  return GUIDES.map((g) => ({ params: { slug: g.slug } }));
}

export const GET: APIRoute = ({ params, site }) =>
  new Response(absolutize(RAW[params.slug!], site), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
