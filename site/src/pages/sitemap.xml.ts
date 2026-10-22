// sitemap.xml: every page a person reads, for search engines. robots.txt points here.
import type { APIRoute } from "astro";
import { GUIDES } from "../data/guides";

const PAGES = ["/", "/help/", "/guides/", "/example-plan/", "/changelog/"];

export const GET: APIRoute = ({ site }) => {
  const base = site!.origin;
  const urls = [...PAGES, ...GUIDES.map((g) => `/guides/${g.slug}/`)];
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) => `  <url><loc>${base}${u}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
