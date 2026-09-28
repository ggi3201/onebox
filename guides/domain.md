# A domain

Runs on: your browser (a registrar's site).

Used by: `box:box-setup`, `box:expose-service`, `box:new-landing-page`.

You need one domain. It carries your API (`api.example.com`), your landing
page, and the privacy policy and support URLs the App Store listing asks for.
DNS for it moves to Cloudflare (see [cloudflare.md](cloudflare.md)), and a
Cloudflare Tunnel sits in front of your box. Buy it at the start of Phase 2,
before you set up the box.

## What it costs

A domain costs about $9-15 a year at a fair registrar, for a `.com`, `.app` or
`.dev`. The number to watch is the **renewal** price, not the first-year
price. On some TLDs, registrars give a discount in year one and charge more
from year two. This guide picks a registrar and a TLD that stay cheap every
year, not only the first.

Every price below was checked **2026-09-28** and is cited at the end of its
section. Prices move; re-check before you buy.

## Pick a registrar

### Cloudflare Registrar (the default for this stack)

Cloudflare sells domains at cost: the registry and ICANN fee, with no markup.
The renewal price is the same as the registration price, so there is no jump
in year two. WHOIS privacy is included free. It supports new registrations
today, not only transfers-in. Cloudflare's own "Register a new domain" docs
cover this. From 2018 to 2022 it was transfer-only, so older articles are
wrong on this point.

Limits that matter here:
- A domain on Cloudflare Registrar must use Cloudflare's nameservers. That is
  no extra step for this stack, because DNS moves there anyway.
- No internationalized (Unicode) domain names.
- Around 390 TLDs are on sale, not every TLD. A few ccTLDs are paused for
  registration from time to time for vendor reasons (`.ca`, `.mx`, `.nz` were
  paused in early 2026). Check the domain's own buy page before you plan
  around it.

Prices, at Cloudflare Registrar, checked 2026-09-28:

| TLD | Registration | Renewal |
|---|---|---|
| `.com` | $10.46 | $10.46 |
| `.app` | $14.20 | $14.20 |
| `.dev` | $12.20 | $12.20 |
| `.net` | $11.86 | $11.86 |
| `.org` | $8.50 | $11.20 |
| `.co` | $30.00 | $30.00 |
| `.io` | $32.00 | $50.00 |
| `.xyz` | $12.30 | $11.20 |

Sources: [Cloudflare Registrar FAQ](https://developers.cloudflare.com/registrar/faq/)
(at-cost pricing, Cloudflare nameservers required), [Register a new domain](https://developers.cloudflare.com/registrar/get-started/register-domain/)
(new registrations, not just transfers), [cfdomainpricing.com](https://cfdomainpricing.com/)
(the table above).

### If Cloudflare does not sell your TLD: 3 common alternatives

Buy the domain at one of these, then move DNS to Cloudflare. The steps are the
same as for any domain; see [cloudflare.md](cloudflare.md).

| Registrar | `.com` first year | `.com` renewal | WHOIS privacy |
|---|---|---|---|
| Porkbun | about $9-10 | about $11 | Free, included by default |
| Namecheap | about $7-9 (promo) | about $15-16 | Free for the life of the domain |
| Spaceship | about $9 | about $10 | Free for life (WithheldForPrivacy) |

All three are fine for a solo app. They are real companies, ICANN-accredited,
with no surprise renewal price on `.com`. Namecheap's first-year promo price
is followed by a bigger jump at renewal than the other two. Plan your budget
on the renewal price, not the first-year price.

Sources: [Porkbun FAQ](https://porkbun.com/about/porkbun-faq) and
[Porkbun pricing, StackScored](https://www.stackscored.com/pricing/domain-registrars/porkbun/);
[Namecheap domains page](https://www.namecheap.com/domains/) and
[Namecheap pricing, SaveLoot](https://saveloot.com/blog/namecheap-com-domain-price-2026);
[Spaceship `.com`](https://www.spaceship.com/domains/gtld/com/) and
[Spaceship domain privacy](https://www.spaceship.com/domains/domain-name-privacy/).

## Which TLD

Ranked for a solo app builder, by renewal price and trust:

| TLD | Renewal (cheapest seen) | Trust for this use |
|---|---|---|
| `.com` | ~$10-11 | Highest. Never looks unusual to a user, to App Review, or to a spam filter. |
| `.app` / `.dev` | ~$12-14 | Second choice. The natural pick when `.com` is taken: it says "app". Both are on the HSTS preload list, so the browser refuses plain HTTP. That is free extra safety, not a problem: this stack is HTTPS-only behind Cloudflare. |
| `.co` | ~$30 | Trusted. People may read it as a typo of `.com`. No abuse reputation, only a higher price. |
| `.io` | ~$50, rising | Common with developers, but the registry's wholesale price keeps rising (again in 2026, and again for 2027). It is no longer cheap. It is also a ccTLD (British Indian Ocean Territory), with no real benefit for an iPhone app. |
| `.net` / `.org` | ~$11-12 | Fine and well-regarded, but no advantage over `.com` for an app. Pick one only as a fallback name. |
| `.xyz` | ~$11-12 renewal, but on promotion for $1-2 | Cheap and technically neutral. But Spamhaus and mail providers often flag `.xyz` (with `.top` and `.icu`) as over-represented in spam and phishing. If you send transactional email from this domain, it can land in spam more often, for no reason tied to your app. Skip it if email matters. |
| `.site`, `.online`, `.store`, `.shop` and similar | Often $30-67 at renewal after a $1 first year | **Avoid.** These extensions sell a domain for $1 and renew it at 30 to 70 times that price a year later. They come from the same registry family as `.xyz`, which has a poor reputation. Do not use them for anything you plan to keep. |

Two examples: a `.store` domain seen at $0.98 to register renews at $66.98, a
68x jump. A `.online` domain at $1.99 has been seen renewing at $34.99. Read
the renewal price before you read the registration price.

Sources: [Spamhaus, domain reputation update Oct 2024 - Mar 2025](https://www.spamhaus.org/resource-hub/domain-reputation/domain-reputation-update-oct-2024-mar-2025/)
and [Spamhaus TLD statistics](https://www.spamhaus.org/statistics/tlds/);
[Spamhaus, XYZ's best practice on new domains](https://www.spamhaus.org/resource-hub/domain-reputation/xyzs-best-practice-on-new-domains-and-email-deliverability/);
[`.io` wholesale price increase, Domain Name Wire](https://domainnamewire.com/2026/07/21/io-price-increase/);
[`.app` on the HSTS preload list](https://instantdomainsearch.com/domain-extensions/app);
[cheap-first-year renewal traps, CyberNews](https://cybernews.com/best-domain-registrars/best-cheap-domain-registrars/)
and [Domain Renewal Cost 2026](https://blog.webhostmost.com/domain-renewal-cost/).

## Country-code domains, in short

A two-letter country domain (`.no`, `.de`, `.fr`, and so on) can need a local
tie to that country. Norway's `.no`, for one, needs a Norwegian organisation
number or a Norwegian national ID and address. A registrar's "local presence"
or "trustee" add-on can get around that, for an extra fee (see
[Norid's own rules](https://www.norid.no/en/om-domenenavn/regelverk-for-no/)).
Some ccTLDs are cheap and well-trusted with no such requirement (`.me`, and
`.io` before its price rose). Do not compare dozens of country codes for a
solo app. It is rarely worth the extra account and the extra rules. Use one
only if your users are mostly in that one country.

## Practical advice

- Pick a name short enough to type from memory. It should also work as the
  app's name on the App Store and as a social handle. Check all three (the
  store name, the domain and the main social handles) before you commit to
  any one of them.
- Buy `.com` if the name is free there. Use `.app` or `.dev` next. Both say
  "this is software" and cost only a little more.
- Avoid hyphens and swapping a letter for a number (`get-myapp.com`,
  `my4pp.com`). Both are harder to say out loud and easier to mistype.
- Turn on auto-renew and registrar lock (sometimes called transfer lock) right
  after you buy. A lapsed domain can be re-registered by someone else within
  days.
- One domain can carry many apps as subdomains: `api.example.com` for one
  app's backend, `app-two.example.com` for another, and so on. That is
  cheaper than a separate domain per app, and it is what `box:expose-service`
  expects.
- The privacy policy and support pages do not need their own domain or
  service. A page on the same landing site the box already serves
  (`example.com/privacy`, `example.com/support`) satisfies both Apple and
  users. Skill: `box:new-landing-page`.

## Steps

1. Pick a name. Check it is free as a domain, as an App Store app name, and
   as a handle on the socials you plan to use.
2. Buy it. Use Cloudflare Registrar for a supported TLD (`.com`, `.app`,
   `.dev`, and about 390 others). Use one of the three alternatives above for
   anything else. Turn on auto-renew and lock at checkout.
3. Move DNS to Cloudflare. Skip this if you bought at Cloudflare Registrar:
   the domain is on Cloudflare's nameservers from the start. Otherwise follow
   [cloudflare.md](cloudflare.md), section "Move the domain's DNS to
   Cloudflare".
4. Write the domain into the onebox config.

## Where the values go

| Value | Goes to |
|---|---|
| The domain (`example.com`) | `box.domain` in `~/.config/onebox/config.json` |

`box:box-setup` and `box:expose-service` read `box.domain` from there. You do
not need to type it into a skill again.

## Check it works

```bash
dig ns example.com @1.1.1.1 +short
```

Expect two names ending in `.ns.cloudflare.com`. Then, once
`box:box-setup` and `box:new-landing-page` have run:

```bash
curl -sI https://example.com | head -1
```

Expect `HTTP/2 200`. If the domain does not resolve yet, the DNS change may
still be spreading. Wait a few minutes and try again. Cloudflare's own DNS
usually updates in minutes, but a nameserver change at the old registrar can
take up to 24 hours.

## Common errors

| Symptom | Cause |
|---|---|
| Domain not found at Cloudflare Registrar's buy page | That TLD is not one of the ~390 it sells. Use one of the three alternatives, then move DNS with [cloudflare.md](cloudflare.md). |
| Registration blocked with an error naming a ccTLD | Some country-code TLDs need local presence or paperwork; see "Country-code domains" above. |
| `dig ns` still shows the old registrar's nameservers after buying elsewhere | DNS change not made yet, or still propagating. Follow [cloudflare.md](cloudflare.md) to move it. |
| A $1-2 first-year price looks too good | Check the renewal price before you buy. See "Which TLD" above. |

Next: [cloudflare.md](cloudflare.md) for DNS, the API token, and the tunnel.
