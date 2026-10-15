# Pick the search words

The name, subtitle and keywords are the only text that counts in search. This
page helps pick the words for them. It fills the fields right. It does not
promise downloads: a good listing only lets people find the app.

## 1. Note what people type

Open the App Store on an iPhone, in the country you sell in. Tap Search. Type
one seed word that fits the app, and stop before you press Search. The list
under the field shows what people search for. Apple lists the most searched
first.

- Note the top three to five suggestions for each seed word.
- Try five to ten seed words: the main feature, the thing the app handles, the
  user's own word for the job.
- Then type a two-word phrase from the list. Its suggestions show longer
  phrases.
- Write down the date and the store. Suggestions change, and they differ by
  country.

## 2. See who ranks for each phrase

Search each phrase and look at the top ten results. The number of ratings
under each app is a rough size.

- The top apps have thousands of ratings: a new app will not rank there soon.
- The top apps have a few dozen ratings or fewer: a new app can rank there.
- Note where the app ranks today, if at all.

## 3. Put the phrases in the fields

- **The name leads with the phrase you can win.** Pick one phrase where only
  weak apps rank, and that says what sets the app apart. Put the brand first,
  then the phrase: `Brand: Phrase`. One phrase, not a list of
  keywords (Guideline 2.3.7).
- **Do not spend the name on the seller.** The App Store already shows the
  seller name under the title. "by Example Labs" only takes room.
- **The subtitle takes the next phrase.** Often the bigger phrase, the one
  strong apps own, because it still helps people who see the app.
- **Each word goes in one field only.** Search combines words across the name,
  subtitle and keywords. "plant care tracker" matches "Plant Care" in the name
  plus `tracker` in the keywords. A word in two fields wastes room.
- **Keywords take the rest,** as single words, as in SKILL.md.
- **Write down how each phrase is covered,** and which words you left out and
  why. The next person needs it to change the listing.

## 4. Leave out what users cannot use yet

A feature only admins or testers can use does not go in any field. The same
holds for a beta that is not open to everyone. App Review compares the
listing with the app it can use. A claim it cannot find can count as
misleading marketing (Guideline 2.3.1(a)). Add the words when the feature
ships to everyone.

Checked on 2026-10-15 against
https://developer.apple.com/app-store/review/guidelines/ (2.3, 2.3.1(a),
2.3.7).

## Keyword bytes in other languages

The keyword field holds 100 **bytes**, not 100 characters. Plain English
letters take 1 byte each. Letters such as `æ`, `ø`, `å`, `é`, `ü` and `ß`
take 2 bytes each. Chinese, Japanese and Korean characters take 3 bytes each.
So a German or Norwegian keyword list fits fewer words. `asc.mjs listing` and
`listing-set` count bytes for keywords and characters for the other fields.
To count by hand:

```bash
node -e 'console.log(Buffer.byteLength(process.argv[1]))' "gießen,blühen,dünger"
```

`gießen,blühen,dünger` is 20 characters but 23 bytes.

## Worked example

An invented plant care app. Its old name was brand first:

| Typed | Top suggestions | Top apps' ratings |
|---|---|---|
| plant | plant identifier, plant care, plant care reminder | thousands, thousands, under 50 |
| watering | watering schedule, watering reminder | a few hundred |
| houseplant | houseplant care, houseplant tracker | under 100 |

"plant identifier" and "plant care" belong to big apps. "plant care reminder"
has only weak apps, and reminders are what this app does best. So it leads
the name. The app also has plant ID from a photo, but only testers have it.
It stays out of the listing for now.

| Field | Old | New | Length |
|---|---|---|---|
| Name | Plantly by Example Labs | Plantly: Plant Care Reminder | 28/30 |
| Subtitle | Keep your plants alive | Watering Schedule & Journal | 27/30 |
| Keywords | `plant care, plants, watering, reminder, app` | `houseplant,garden,tracker,succulent,indoor,log,fertilizer,repot,diary,green,calendar,alert,light` | 96/100 bytes |

How the fields cover the searches:

- "plant care reminder" = name
- "watering schedule" = subtitle
- "houseplant tracker" = `houseplant` + `tracker` (keywords)
- "plant care tracker" = Plant Care (name) + `tracker` (keywords)
- "succulent care" = `succulent` (keywords) + Care (name)

Left out: `plants` and `plant` (in the name), `watering` and `reminder`
(already in a field), `app` (wastes bytes), `identifier` (testers only).

The home screen name (`expo.name`) is a separate field. Keep it short, such
as "Plantly", so iOS does not cut it off under the icon.
