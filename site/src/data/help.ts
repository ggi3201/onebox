// The paid help offer on /help/. Prices live here once, so the page, the
// size picker and llms.txt never disagree.

import { APPS } from "./kit";

export const EMAIL = "geir@lokkesveen.com";

// The founding discount: the first FIRST_JOBS jobs get it. Lower
// FIRST_JOBS_LEFT by one when a job is taken; 0 hides the line.
export const FIRST_JOBS = 3;
export const FIRST_JOBS_LEFT = FIRST_JOBS;
export const FIRST_JOBS_DISCOUNT = "40%";

export const CHECK_PRICE = "$99";
export const UPDATE_PRICE = "$79";

export type SizeId = "small" | "medium" | "large" | "rejected";
export type Size = { id: SizeId; name: string; price: string; lead: string; items: string[] };

export const SIZES: Size[] = [
  {
    id: "small",
    name: "Small",
    price: "from $349",
    lead: "A clean Expo app that works and needs the Apple part done.",
    items: [
      "Store page, privacy answers and review notes",
      "A demo account for the reviewer, if the app needs one",
      "Build, TestFlight and submit",
      "Up to 2 rejection rounds",
    ],
  },
  {
    id: "medium",
    name: "Medium",
    price: "from $549",
    lead: "Everything in Small, plus login, privacy or payment work.",
    items: [
      "Account deletion inside the app",
      "A demo account for the reviewer",
      "In-app purchase or subscriptions with RevenueCat, instead of Stripe for digital goods",
    ],
  },
  {
    id: "large",
    name: "Large",
    price: `Quote after the ${CHECK_PRICE} check`,
    lead: "An app that needs real fixing before Apple will look at it.",
    items: [
      "The check gives you a fix list and a fixed price",
      "You decide before any work starts",
    ],
  },
  {
    id: "rejected",
    name: "Rejected",
    price: "from $149",
    lead: "Apple said no, and you do not know why.",
    items: [
      "Send me the rejection text",
      "I name the cause in plain words and fix it",
      "I write the reply to Apple and resubmit",
      "Bigger code changes get a quote first",
    ],
  },
];

// The lowest "from" price, for "From $149" lines on the homepage and in meta text.
const fromPrices = SIZES.map((s) => Number(s.price.match(/^from \$(\d+)$/)?.[1])).filter((n) => n > 0);
export const FROM_PRICE = `$${Math.min(...fromPrices)}`;

// The apps shipped with these skills, as proof on / and /help/.
export const SHIPPED = ["Thraed", "Foodie", "Lift"].map((name) => {
  const app = APPS.find((a) => a.name === name);
  if (!app) throw new Error(`kit.ts has no app "${name}"`);
  return app;
});

export const mailto = (subject: string, body?: string) =>
  `mailto:${EMAIL}?subject=${encodeURIComponent(subject)}` + (body ? `&body=${encodeURIComponent(body)}` : "");

const intake = "Link to the app or repo:\n\nTool you built it with:\n\nWhere you are stuck (paste Apple's message if you have one):\n";
export const ASK_MAIL = mailto("Where I'm stuck", intake);
export const CHECK_MAIL = mailto("App Review check", intake);
export const FEATURE_MAIL = mailto(
  "Feature work",
  "Link to the app or repo:\n\nWhat you want built:\n\nWhen you need it:\n",
);
