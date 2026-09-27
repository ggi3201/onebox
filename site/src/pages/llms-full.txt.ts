// Every guide in one file, in reading order, for pasting into a chat.
import type { APIRoute } from "astro";
import { GUIDES, RAW, absolutize } from "../data/guides";

export const GET: APIRoute = ({ site }) => {
  const body = GUIDES.map((g) => `<!-- ${site!.origin}/guides/${g.slug}/ -->\n\n${absolutize(RAW[g.slug], site).trim()}`).join("\n\n---\n\n");
  return new Response(`# onebox guides\n\n${body}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
