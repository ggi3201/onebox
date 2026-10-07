# What each question means

Use this when the user asks "what does this mean?". Each answer changes which
items go into `PLAN.md`. The exact rules are in `catalog.json`.

## Where is your app now? (`stage`)

It tells the plan where you start. **An idea** adds the `start:new-app`
skill, which makes the repo. **On TestFlight** marks the accounts, the App
Store Connect setup, the local build and the app icon as likely done. **On
the App Store** also marks the screenshots, the store text and the landing
page (or the privacy and support pages) as likely done, because App Review
needs them. Detection knows an Expo app from the repo. It sees an App Store
Connect app id in `eas.json`, but it cannot tell TestFlight from the App
Store, so the plan asks.

## Does the app need a server? (`backend`)

A server holds data that must live off the phone: accounts, sync, AI calls
with a secret key. **Your own box** adds a VPS or mini PC, Cloudflare, the box
setup, the backend guide, a public API hostname and a staging API. **A hosted
backend** (Supabase, Convex or Firebase) replaces the box steps with the
hosted-backend guide. **No server** skips both. With either
of those two, a landing page still adds a small VPS to host it.

The backend item is ticked only when the API is deployed **and** protected:
the real client IP behind the tunnel, a rate limiter, and (in .NET) a body
size limit, as in the backend guide's "Protect the API".

## Do users sign in? (`login`)

With accounts, the plan adds Sign in with Apple, checked on your server.
Apple asks for it (or an equal private option) when you offer another social
login. App Review also checks that users can delete their account inside the
app. **Yes, but later** keeps the same step, and moves it to after your first
TestFlight build. **No accounts** leaves it out.

**No accounts** with AI is a warning: AI limits can then only count per
device and per IP, and a person can reset them. Sign in with Apple makes
the limits hold. `app-features:ai-usage-limits`, "No accounts", says what to
do without it.

## Will users pay inside the app? (`paid`)

Paid apps add the RevenueCat guide and the `revenuecat.apiKeyRef` config key.
You also sign Apple's Paid Apps agreement before you can sell anything.

## Do you want a landing page? (`site`)

App Store Connect needs a public privacy policy URL and a support URL either
way. **Yes** adds a domain, Cloudflare and the landing page skill, which makes
those pages too. It also adds a small VPS if you have no box yet. **No**
means you host those two pages somewhere else yourself.

## Does the app use AI? (`ai`, pick any)

- **Chat or agent**: an LLM key, a chat screen, a cost budget per user, the AI
  consent Apple asks for, and tracing. With your own box it also adds a
  server-side agent and background jobs.
- **Turn a shared link into data**: the import skill, with the same key,
  budget, consent and tracing.
- **Generated images or video**: a kie.ai key and the image and video
  skills. The skills also work with fal.ai or Replicate.

**No server** with chat or import is a conflict. The AI key would have to
ship inside the app, and anyone can read it from the app file. The plan asks
the user to pick a hosted backend or their own box, or to leave AI out.
With images or video only, it is a warning: images made inside the app need
a server too, but images for the store page and social posts do not.

## Do you want to fix things from your phone? (`remote`)

Only asked when you run your own box. **Yes** adds the guide that puts your
box, Mac and phone on one private network, so you or your coding agent can reach the box
from anywhere.
