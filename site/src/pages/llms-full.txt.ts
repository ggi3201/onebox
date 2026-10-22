// Every guide in one file, in reading order, for pasting into a chat. The paid
// help page comes last, built from the same data as /help/.
import type { APIRoute } from "astro";
import { GUIDES, RAW, absolutize } from "../data/guides";
import { SIZES, CHECK_PRICE, UPDATE_PRICE, EMAIL } from "../data/help";

const help = (origin: string) =>
  [
    `<!-- ${origin}/help/ -->`,
    "",
    "# Get your Expo app through App Review",
    "",
    "Paid help from the author of onebox. I get Expo apps built with AI tools (Claude Code, Cursor, Rork, Bolt) through App Review. You keep your Apple account. You know the price before I start.",
    "",
    "## How the price is set",
    "",
    "1. Free answer: tell me where you are stuck. I reply in writing.",
    `2. App Review check, ${CHECK_PRICE}: a fix list and a fixed quote within 48 hours. The ${CHECK_PRICE} counts toward the job if you go ahead within 14 days.`,
    "3. Fixed price: half at the start, half when the app is submitted.",
    "",
    "## Sizes",
    "",
    ...SIZES.map((s) => `- ${s.name}, ${s.price}. ${s.lead} ${s.items.join(". ")}.`),
    `- After launch: Update pass, ${UPDATE_PRICE} per release.`,
    `- Feature work in an Expo app: case by case, with a fixed quote before work starts.`,
    "",
    "No approval promise; Apple decides. No Android, no web wrappers, no Guideline 4.3 spam cases, no security audit.",
    "",
    `Contact: ${EMAIL}`,
  ].join("\n");

export const GET: APIRoute = ({ site }) => {
  const body = GUIDES.map((g) => `<!-- ${site!.origin}/guides/${g.slug}/ -->\n\n${absolutize(RAW[g.slug], site).trim()}`).join("\n\n---\n\n");
  return new Response(`# onebox guides\n\n${body}\n\n---\n\n${help(site!.origin)}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
