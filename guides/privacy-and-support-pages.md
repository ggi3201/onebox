# Privacy policy and support page, without a landing page

Runs on: your browser. No server needed.

Apple asks every app for two public web pages, even a free app with no
accounts: a **privacy policy** and a **support page**. If you use
`box:new-landing-page`, those pages come with it and you can skip this guide.
If you do not want a landing page, this guide gets you the two pages for free
in about half an hour.

## What Apple needs

| Page | Where you enter the URL | Needed when |
|---|---|---|
| Privacy policy | App Store Connect → your app → App Privacy | Always |
| Support page | App Store Connect → your app → the version page | Always |
| Terms of use (EULA) | The App Store description, or the custom EULA field | You sell subscriptions ([revenuecat.md](revenuecat.md)) |

Rules that people often miss:

- The URLs must be **public** and load without a login.
- The privacy policy must **match your App Privacy answers** in App Store
  Connect. If the app sends data to an AI provider or RevenueCat, the policy
  says so.
- A subscription paywall must also link to the privacy policy and the terms
  inside the app (App Review Guideline 3.1.2). Apple's standard EULA
  (`https://www.apple.com/legal/internet-services/itunes/dev/stdeula/`) is
  fine as the terms if you have none of your own.
- The support page needs a way to reach you: an email address is enough.

## Where to host the two pages

Pick one. All are free.

| Option | Good for | Watch out |
|---|---|---|
| **GitHub Pages** | You already use GitHub | Free only from a **public** repository. The pages are public anyway, so make a small public repo just for them |
| **Cloudflare Pages** | Your domain is already on Cloudflare | A few more steps than GitHub Pages; gives you `privacy.example.com` style URLs |
| **Notion (published page)** | The fastest | Looks like Notion, not like your app; the URL is long |

A page on your own domain looks most trustworthy to reviewers and users, but
any stable public URL is accepted.

### GitHub Pages in five steps

1. Create a public repository, for example `myapp-pages`.
2. Add two files: `privacy.md` and `support.md` (the checklists below).
3. In the repository's settings, open **Pages**, choose **Deploy from a
   branch**, pick `main` and the root folder, and save.
4. Wait a minute. The pages are at
   `https://<user>.github.io/myapp-pages/privacy` and `…/support`.
5. Open both URLs in a private browser window to prove they are public.

## What the privacy policy says

Use plain words, not legal-sounding ones. Cover each point in one or two
sentences:

- [ ] **Who you are** and how to contact you (name or company, email).
- [ ] **What the app collects**: account data (Sign in with Apple gives a
      name and an email, which may be a private relay address), content the
      user creates, purchase status, crash or usage data if you collect any.
- [ ] **Why**: to run the features. Say "we do not sell your data" if true.
- [ ] **Who else gets it** (processors): your hosting, RevenueCat, an AI
      provider, an analytics or crash tool. Name each one.
- [ ] **AI features**: what is sent to the model provider, and that the user
      agreed to it in the app (see `app-features:ai-consent` if you have AI).
- [ ] **Where it is stored** and **how long**.
- [ ] **Deleting the account**: where in the app, and what gets deleted.
      Apple requires in-app account deletion when the app has sign-up.
- [ ] **Children**: say the app is not made for children under 13 (or your
      country's age), unless it is.
- [ ] **Changes**: the date of this version, and that you will update the page.

If users are in the EU or the UK, also name the legal basis (usually
"to provide the service you asked for") and the right to see, correct and
delete their data. This checklist is a starting point, not legal advice.

## What the support page says

- [ ] The app's name and one line about what it does.
- [ ] How to reach you: an email address, and how fast you usually answer.
- [ ] Answers to the two or three questions you will get most, for example
      "how do I restore my purchase" and "how do I delete my account".
- [ ] A link to the privacy policy.

## Where the values go

| Value | Where |
|---|---|
| Privacy policy URL | App Store Connect → App Privacy; also in the app's settings screen and the paywall |
| Support URL | App Store Connect → your app → the version page |
| Terms of use URL | App Store description, or the custom EULA field; also on the paywall |

## Check it works

- Both URLs open in a private browser window, on your phone, on mobile data.
- The privacy policy lists every service that
  [App Privacy](app-store-connect-setup.md) says receives data.
- `ship-ios:app-store-ready` reports the privacy and support URLs as OK.

## Common errors

- **"The support URL does not lead to support information."** A bare home
  page or a 404. Put a contact email on the page itself.
- **Rejected under 5.1.1 for a missing privacy policy.** The link in the
  app's settings or paywall is missing, even though App Store Connect has one.
- **GitHub Pages shows a 404.** Pages is not enabled, or the repository is
  private on a free account.
