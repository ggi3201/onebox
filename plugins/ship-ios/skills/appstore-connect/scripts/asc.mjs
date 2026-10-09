#!/usr/bin/env node
// App Store Connect API from the command line. Node 18+, no dependencies.
//
// Read commands:
//   node asc.mjs apps
//   node asc.mjs builds  --app <bundleId|appId> [--limit 10]
//   node asc.mjs build   <buildId>
//   node asc.mjs wait    <buildId> [--minutes 60]       poll until VALID and ready for testers
//   node asc.mjs groups  --app <bundleId|appId>
//   node asc.mjs testers --group <groupId>
//   node asc.mjs subs    --app <bundleId|appId>         subscription groups and products
//   node asc.mjs listing --app <bundleId|appId> [--locale en-US]   store page text, with length checks
//   node asc.mjs versions --app <bundleId|appId>        App Store versions and their states
//   node asc.mjs review-status --app <bundleId|appId>   the version page: what is filled, what is missing
//   node asc.mjs categories                             category ids for version-set
//   node asc.mjs get     <path>                         any GET, e.g. '/v1/apps?limit=5'
//
// Write commands (all take --dry-run, which prints the request and changes nothing):
//   node asc.mjs expire      <buildId>
//   node asc.mjs compliance  <buildId> --no-encryption  answer the export question for one build
//   node asc.mjs add-build   --group <groupId> --build <buildId>
//   node asc.mjs add-tester  --group <groupId> --email <email> [--first A --last B]
//   node asc.mjs subs-create <plan.json> [--equalize]  subscription group + products, see api.md
//   node asc.mjs listing-set <listing.json> --app <bundleId|appId>  store page text, see api.md
//   node asc.mjs age-rating-set <age.json> --app <bundleId|appId>   the age rating answers, see api.md
//   node asc.mjs version-set <version.json> --app <bundleId|appId>  copyright, categories, content rights,
//                                                       review details, release type, phased release; see api.md
//   node asc.mjs attach-build --app <bundleId|appId> --build <buildId>   the build on the version page
//   node asc.mjs submit      --app <bundleId|appId>     send the version to App Review
//   node asc.mjs release     --app <bundleId|appId>     release an approved version (manual release)
//   node asc.mjs call        <METHOD> <path> [body.json]
//
// Output is plain text. Add --json to any read command for the raw API answer.
// The private key is read into memory and signed locally. It is never printed.
import fs from 'fs'; import path from 'path'; import os from 'os'; import crypto from 'crypto';
import { readSecret } from './secret.mjs';

// ---- onebox ASC auth ------------------------------------------------------
// This block is identical in ship-ios/skills/appstore-connect/scripts/asc.mjs
// and ship-ios/skills/app-store-screenshots/scripts/asc.mjs, so each skill
// installs on its own. Change both or neither.
//
// Credentials, first match wins:
//   1. ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH (or ASC_PRIVATE_KEY, the .p8 text)
//   2. onebox config: apple.ascKeyId, apple.ascIssuerId, and apple.ascKeyPath
//      or apple.ascKeyRef (a secret reference, read as CONFIG.md "Secrets" says)
//   3. ~/.appstoreconnect/config.json with { key_id, issuer_id, key_path }
function oneboxConfig() {
  const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
  const merge = (a, b) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a?.[k] || {}, v) : v;
    return out;
  };
  let project = {};
  for (let d = process.cwd(); ; d = path.dirname(d)) {
    const f = path.join(d, '.onebox.json');
    if (fs.existsSync(f)) { project = read(f); break; }
    if (path.dirname(d) === d) break;
  }
  return merge(read(path.join(os.homedir(), '.config/onebox/config.json')), project);
}
function ascCreds() {
  const home = p => (p || '').replace(/^~(?=$|\/)/, os.homedir());
  const pem = s => s && s.replace(/\\n/g, '\n').trim() + '\n';
  const e = process.env;
  if (e.ASC_KEY_ID && e.ASC_ISSUER_ID && (e.ASC_KEY_PATH || e.ASC_PRIVATE_KEY))
    return { keyId: e.ASC_KEY_ID, issuer: e.ASC_ISSUER_ID, key: e.ASC_PRIVATE_KEY ? pem(e.ASC_PRIVATE_KEY) : fs.readFileSync(home(e.ASC_KEY_PATH)) };
  const cfg = oneboxConfig(), a = cfg.apple || {};
  if (a.ascKeyId && a.ascIssuerId && (a.ascKeyPath || a.ascKeyRef)) {
    const key = a.ascKeyPath ? fs.readFileSync(home(a.ascKeyPath)) : pem(readSecret(cfg, a.ascKeyRef));
    if (!key || !String(key).includes('PRIVATE KEY')) throw new Error(`apple.ascKeyRef "${a.ascKeyRef}" did not resolve to a .p8 key.`);
    return { keyId: a.ascKeyId, issuer: a.ascIssuerId, key };
  }
  const legacy = path.join(os.homedir(), '.appstoreconnect/config.json');
  if (fs.existsSync(legacy)) {
    const c = JSON.parse(fs.readFileSync(legacy, 'utf8'));
    if (c.key_id && c.issuer_id && c.key_path) return { keyId: c.key_id, issuer: c.issuer_id, key: fs.readFileSync(home(c.key_path)) };
  }
  throw new Error('No App Store Connect API key. Set apple.ascKeyId, apple.ascIssuerId and apple.ascKeyPath (or apple.ascKeyRef) '
    + 'in ~/.config/onebox/config.json. How to get one: https://onebox.lokkesveen.com/guides/app-store-connect-api-key.md');
}
let CREDS;
function ascToken() {
  CREDS ||= ascCreds();
  const b = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  // Apple rejects a token that lives longer than 20 minutes.
  const data = b({ alg: 'ES256', kid: CREDS.keyId, typ: 'JWT' }) + '.' + b({ iss: CREDS.issuer, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' });
  return data + '.' + crypto.sign('sha256', Buffer.from(data), { key: CREDS.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
}
async function api(method, p, body) {
  const url = p.startsWith('http') ? p : 'https://api.appstoreconnect.apple.com' + p;
  const r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + ascToken(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${t.slice(0, 1200)}`);
  return t ? JSON.parse(t) : null;
}
// ---- end onebox ASC auth --------------------------------------------------

const argv = process.argv.slice(2);
const cmd = argv[0];
const pos = [], args = {};
for (let i = 1; i < argv.length; i++) {
  const x = argv[i];
  if (x.startsWith('--')) { const n = argv[i + 1]; if (n !== undefined && !n.startsWith('--')) { args[x.slice(2)] = n; i++; } else args[x.slice(2)] = true; }
  else pos.push(x);
}
const DRY = !!args['dry-run'], JSON_OUT = !!args.json;
const q = o => '?' + new URLSearchParams(o).toString(); // encodes [ and ] for us
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A dry run prints the request. It never prints a password, not even a demo one.
const hide = (k, v) => /password/i.test(k) && typeof v === 'string' ? '(hidden)' : v;
async function write(method, p, body) {
  if (DRY) { console.log(`dry run: ${method} ${p}` + (body ? '\n' + JSON.stringify(body, hide, 2) : '')); return { data: { id: '(dry-run)' } }; }
  return api(method, p, body);
}
async function all(p) { // follow pagination
  const out = []; let next = p;
  while (next) { const r = await api('GET', next); out.push(...r.data); next = r.links?.next; }
  return out;
}
async function appOf(ref) {
  if (!ref) throw new Error('--app <bundleId|appId> is required');
  const r = /^\d+$/.test(ref) ? await api('GET', `/v1/apps/${ref}`) : await api('GET', '/v1/apps' + q({ 'filter[bundleId]': ref }));
  // Exact match only: the filter can also return myapp.staging for myapp, and
  // submit or release must never act on the wrong app.
  const a = Array.isArray(r.data) ? r.data.find(x => x.attributes.bundleId === ref) : r.data;
  if (!a) throw new Error(`App not found: ${ref}. Apps must be created in the App Store Connect web UI (POST /v1/apps is not allowed).`);
  return a;
}
const need = (v, what) => { if (!v) throw new Error(`missing ${what}`); return v; };

// ---- store page text ------------------------------------------------------
// Name, subtitle and privacy URL live on the app info. The rest lives on one
// App Store version. Only a version or app info that is not yet in review or
// live can change, except promotional text, which can change on a live version.
const LIMITS = { name: 30, subtitle: 30, promotionalText: 170, description: 4000, whatsNew: 4000, keywords: 100 };
const INFO_FIELDS = ['name', 'subtitle', 'privacyPolicyUrl'];
const VERSION_FIELDS = ['description', 'keywords', 'promotionalText', 'whatsNew', 'supportUrl', 'marketingUrl'];
const EDITABLE = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY', 'READY_FOR_REVIEW'];
const LIVE = ['READY_FOR_SALE', 'READY_FOR_DISTRIBUTION'];
const stateOf = a => a.appVersionState || a.appStoreState || a.state;
const size = (k, v) => k === 'keywords' ? Buffer.byteLength(v || '', 'utf8') : [...(v || '')].length;
async function listingParts(app, locale) {
  const versions = await all(`/v1/apps/${app.id}/appStoreVersions` + q({ 'filter[platform]': 'IOS', limit: 20 }));
  const edit = versions.find(v => EDITABLE.includes(stateOf(v.attributes)));
  const live = versions.find(v => LIVE.includes(stateOf(v.attributes)));
  const infos = await all(`/v1/apps/${app.id}/appInfos` + q({ limit: 10 }));
  const info = infos.find(i => EDITABLE.includes(stateOf(i.attributes))) || infos.find(i => !LIVE.includes(stateOf(i.attributes))) || null;
  const locOf = async (base, id, kind) => {
    if (!id) return null;
    const ls = await all(`/v1/${base}/${id}/${kind}` + q({ limit: 50 }));
    return ls.find(x => x.attributes.locale === locale) || { missing: ls.map(x => x.attributes.locale) };
  };
  return {
    edit, live, info,
    infoLoc: await locOf('appInfos', info?.id || infos[0]?.id, 'appInfoLocalizations'),
    editLoc: await locOf('appStoreVersions', edit?.id, 'appStoreVersionLocalizations'),
    liveLoc: await locOf('appStoreVersions', live?.id, 'appStoreVersionLocalizations'),
  };
}
function keywordNotes(kw, name, subtitle) {
  const notes = [];
  if (!kw) return notes;
  if (/,\s/.test(kw)) notes.push('spaces after commas waste bytes: use "a,b,c"');
  const words = kw.split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
  const title = new Set(`${name || ''} ${subtitle || ''}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const dup = words.filter(w => title.has(w));
  if (dup.length) notes.push(`already in the name or subtitle, so they add nothing here: ${dup.join(', ')}`);
  const seen = new Set(), twice = words.filter(w => seen.has(w) || !seen.add(w));
  if (twice.length) notes.push(`listed twice: ${[...new Set(twice)].join(', ')}`);
  const all = new Set([...words, ...title]);
  const plural = words.filter(w => w.length > 3 && w.endsWith('s') && all.has(w.slice(0, -1)));
  if (plural.length) notes.push(`Apple counts plurals as duplicates: ${plural.join(', ')}`);
  return notes;
}

// ---- the version page and the review submission ---------------------------
// What the API can fill: copyright, release type, phased release, the build,
// review details, categories, content rights, the age rating, and the
// submission itself. What it cannot: the App Privacy answers and the EU trader
// status. Those stay on their pages in App Store Connect.
const LEVEL = ['NONE', 'INFREQUENT_OR_MILD', 'FREQUENT_OR_INTENSE', 'INFREQUENT', 'FREQUENT'];
const AGE_LEVEL_FIELDS = ['alcoholTobaccoOrDrugUseOrReferences', 'contests', 'gamblingSimulated', 'gunsOrOtherWeapons',
  'horrorOrFearThemes', 'matureOrSuggestiveThemes', 'medicalOrTreatmentInformation', 'profanityOrCrudeHumor',
  'sexualContentGraphicAndNudity', 'sexualContentOrNudity', 'violenceCartoonOrFantasy', 'violenceRealistic',
  'violenceRealisticProlongedGraphicOrSadistic'];
const AGE_BOOL_FIELDS = ['advertising', 'ageAssurance', 'gambling', 'healthOrWellnessTopics', 'lootBox', 'messagingAndChat',
  'parentalControls', 'socialMedia', 'socialMediaAgeRestricted', 'unrestrictedWebAccess', 'userGeneratedContent'];
const AGE_ENUM_FIELDS = {
  kidsAgeBand: ['FIVE_AND_UNDER', 'SIX_TO_EIGHT', 'NINE_TO_ELEVEN'],
  ageRatingOverrideV2: ['NONE', 'NINE_PLUS', 'THIRTEEN_PLUS', 'SIXTEEN_PLUS', 'EIGHTEEN_PLUS', 'UNRATED'],
  koreaAgeRatingOverride: ['NONE', 'ALL', 'TWELVE_PLUS', 'FIFTEEN_PLUS', 'NINETEEN_PLUS'],
};
// The questions a declaration must answer. socialMediaAgeRestricted only matters with socialMedia.
const ageUnanswered = a => [...AGE_LEVEL_FIELDS, ...AGE_BOOL_FIELDS]
  .filter(k => a?.[k] == null && !(k === 'socialMediaAgeRestricted' && a?.socialMedia !== true));
const RELEASE_TYPES = ['MANUAL', 'AFTER_APPROVAL', 'SCHEDULED'];
const CONTENT_RIGHTS = ['DOES_NOT_USE_THIRD_PARTY_CONTENT', 'USES_THIRD_PARTY_CONTENT'];
const REVIEW_FIELDS = ['contactFirstName', 'contactLastName', 'contactEmail', 'contactPhone', 'notes',
  'demoAccountRequired', 'demoAccountName', 'demoAccountPasswordRef'];
const VERSION_SET_FIELDS = ['app', 'copyright', 'primaryCategory', 'secondaryCategory', 'contentRights',
  'releaseType', 'earliestReleaseDate', 'phasedRelease', 'review'];
const OPEN_SUBMISSION = ['READY_FOR_REVIEW', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'UNRESOLVED_ISSUES', 'CANCELING', 'COMPLETING'];
const incOf = r => Object.fromEntries((r.included || []).map(x => [x.type + ':' + x.id, x]));
const relOf = (r, inc, name) => { const d = r.data.relationships?.[name]?.data; return d ? inc[d.type + ':' + d.id] || { id: d.id, type: d.type } : null; };
const tryApi = async (method, p) => { try { return { r: await api(method, p) }; } catch (e) { return { err: e.message.match(/-> (\d+)/)?.[1] || e.message.slice(0, 120) }; } };

// The version the page shows: the one being prepared, else the newest.
async function versionPage(app) {
  const versions = (await all(`/v1/apps/${app.id}/appStoreVersions` + q({ 'filter[platform]': 'IOS', limit: 20 })))
    .sort((a, b) => String(b.attributes.createdDate).localeCompare(String(a.attributes.createdDate)));
  const v = versions.find(x => EDITABLE.includes(stateOf(x.attributes))) || versions[0];
  if (!v) throw new Error('This app has no App Store version yet. Make one in App Store Connect (the add button next to iOS App), then run this again.');
  const r = await api('GET', `/v1/appStoreVersions/${v.id}` + q({ include: 'build,appStoreReviewDetail,appStoreVersionPhasedRelease' }));
  const inc = incOf(r);
  return { versions, version: r.data, editable: EDITABLE.includes(stateOf(r.data.attributes)), live: versions.find(x => LIVE.includes(stateOf(x.attributes))),
    build: relOf(r, inc, 'build'), review: relOf(r, inc, 'appStoreReviewDetail'), phased: relOf(r, inc, 'appStoreVersionPhasedRelease') };
}
async function infoPage(app) {
  const infos = await all(`/v1/apps/${app.id}/appInfos` + q({ limit: 10 }));
  const info = infos.find(i => EDITABLE.includes(stateOf(i.attributes))) || infos.find(i => !LIVE.includes(stateOf(i.attributes))) || null;
  if (!info) return { info: null };
  const r = await api('GET', `/v1/appInfos/${info.id}` + q({ include: 'ageRatingDeclaration,primaryCategory,secondaryCategory' }));
  const inc = incOf(r);
  return { info: r.data, age: relOf(r, inc, 'ageRatingDeclaration'), primary: relOf(r, inc, 'primaryCategory'), secondary: relOf(r, inc, 'secondaryCategory') };
}
async function openSubmissions(app) {
  const subs = await all('/v1/reviewSubmissions' + q({ 'filter[app]': app.id, 'filter[platform]': 'IOS', limit: 20 }));
  return subs.filter(s => OPEN_SUBMISSION.includes(s.attributes.state));
}
function editableOrStop(p) {
  if (!p.editable) throw new Error(`Version ${p.version.attributes.versionString} is ${stateOf(p.version.attributes)}, so it cannot change. `
    + 'Make a new version in App Store Connect first. Nothing sent.');
}

const commands = {
  async apps() {
    const apps = await all('/v1/apps' + q({ limit: 200, 'fields[apps]': 'name,bundleId,sku' }));
    if (JSON_OUT) return console.log(JSON.stringify(apps, null, 2));
    for (const a of apps) console.log(`${a.attributes.name}  ${a.attributes.bundleId}  id=${a.id}`);
  },

  async builds() {
    const app = await appOf(args.app);
    const r = await api('GET', '/v1/builds' + q({ 'filter[app]': app.id, sort: '-uploadedDate', limit: args.limit || 10,
      include: 'preReleaseVersion,buildBetaDetail', 'fields[builds]': 'version,uploadedDate,processingState,expired,usesNonExemptEncryption,preReleaseVersion,buildBetaDetail' }));
    if (JSON_OUT) return console.log(JSON.stringify(r, null, 2));
    const inc = Object.fromEntries((r.included || []).map(x => [x.type + ':' + x.id, x.attributes]));
    console.log('version (build)  processing  internal / external  expired  uploaded  id');
    for (const b of r.data) {
      const v = inc['preReleaseVersions:' + b.relationships?.preReleaseVersion?.data?.id]?.version || '?';
      const d = inc['buildBetaDetails:' + b.relationships?.buildBetaDetail?.data?.id] || {};
      console.log(`${v} (${b.attributes.version})  ${b.attributes.processingState}  ${d.internalBuildState || '-'} / ${d.externalBuildState || '-'}  ${b.attributes.expired}  ${b.attributes.uploadedDate?.slice(0, 16)}  ${b.id}`);
    }
  },

  async build() {
    const id = need(pos[0], '<buildId>');
    const r = await api('GET', `/v1/builds/${id}` + q({ include: 'preReleaseVersion,buildBetaDetail,betaGroups' }));
    if (JSON_OUT) return console.log(JSON.stringify(r, null, 2));
    const a = r.data.attributes, inc = r.included || [];
    const v = inc.find(x => x.type === 'preReleaseVersions')?.attributes.version;
    const d = inc.find(x => x.type === 'buildBetaDetails')?.attributes || {};
    const groups = inc.filter(x => x.type === 'betaGroups').map(g => g.attributes.name);
    console.log(`version ${v} build ${a.version}\nprocessingState ${a.processingState}\ninternal ${d.internalBuildState}\nexternal ${d.externalBuildState}`
      + `\nexpired ${a.expired}\nusesNonExemptEncryption ${a.usesNonExemptEncryption}\nuploaded ${a.uploadedDate}\nexpires ${a.expirationDate}\ngroups ${groups.join(', ') || '(none)'}`);
  },

  async wait() {
    const id = need(pos[0], '<buildId>'), until = Date.now() + (+args.minutes || 60) * 60000;
    for (;;) {
      const r = await api('GET', `/v1/builds/${id}` + q({ include: 'buildBetaDetail' }));
      const s = r.data.attributes.processingState, d = r.included?.[0]?.attributes || {};
      console.log(`${new Date().toISOString().slice(11, 19)}  ${s}  ${d.internalBuildState || ''}`);
      if (s === 'FAILED' || s === 'INVALID') throw new Error(`Build ${s}. Apple emails the reason to the account holder.`);
      if (d.internalBuildState === 'MISSING_EXPORT_COMPLIANCE') return console.log('Processed, but waiting on export compliance. Run: asc.mjs compliance ' + id + ' --no-encryption (if true), and set ITSAppUsesNonExemptEncryption in app config for next time.');
      if (s === 'VALID' && ['READY_FOR_BETA_TESTING', 'IN_BETA_TESTING'].includes(d.internalBuildState)) return console.log('Ready. The TestFlight notification on phones can lag 5-60 minutes behind this.');
      if (Date.now() > until) return console.log('Still processing. Check again later.');
      await sleep(60000);
    }
  },

  async groups() {
    const app = await appOf(args.app);
    const gs = await all(`/v1/apps/${app.id}/betaGroups` + q({ limit: 200 }));
    if (JSON_OUT) return console.log(JSON.stringify(gs, null, 2));
    for (const g of gs) { const a = g.attributes; console.log(`${a.name}  ${a.isInternalGroup ? 'internal' : 'external'}${a.hasAccessToAllBuilds ? ' all-builds' : ''}${a.publicLinkEnabled ? ' public-link ' + a.publicLink : ''}  id=${g.id}`); }
  },

  async testers() {
    const g = need(args.group, '--group <groupId>');
    const ts = await all(`/v1/betaGroups/${g}/betaTesters` + q({ limit: 200 }));
    if (JSON_OUT) return console.log(JSON.stringify(ts, null, 2));
    for (const t of ts) { const a = t.attributes; console.log(`${a.email || '(no email)'}  ${a.firstName || ''} ${a.lastName || ''}  ${a.state || ''}  id=${t.id}`); }
  },

  async get() { console.log(JSON.stringify(await api('GET', need(pos[0], '<path>')), null, 2)); },

  async expire() {
    const id = need(pos[0], '<buildId>');
    await write('PATCH', `/v1/builds/${id}`, { data: { type: 'builds', id, attributes: { expired: true } } });
    if (!DRY) console.log(`Expired ${id}. Testers can no longer install it. This cannot be undone.`);
  },

  async compliance() {
    const id = need(pos[0], '<buildId>');
    if (!args['no-encryption']) throw new Error('Pass --no-encryption only if the app uses no encryption beyond HTTPS and the OS. Otherwise answer in the web UI.');
    await write('PATCH', `/v1/builds/${id}`, { data: { type: 'builds', id, attributes: { usesNonExemptEncryption: false } } });
    if (!DRY) console.log(`Build ${id}: usesNonExemptEncryption=false.`);
  },

  async 'add-build'() {
    const g = need(args.group, '--group'), b = need(args.build, '--build');
    await write('POST', `/v1/betaGroups/${g}/relationships/builds`, { data: [{ type: 'builds', id: b }] });
    if (!DRY) console.log(`Added build ${b} to group ${g}. External groups need Beta App Review before testers see it.`);
  },

  async 'add-tester'() {
    const g = need(args.group, '--group'), email = need(args.email, '--email');
    const attributes = { email }; if (args.first) attributes.firstName = args.first; if (args.last) attributes.lastName = args.last;
    await write('POST', '/v1/betaTesters', { data: { type: 'betaTesters', attributes, relationships: { betaGroups: { data: [{ type: 'betaGroups', id: g }] } } } });
    if (!DRY) console.log(`Invited ${email} to group ${g}. Apple sends the invite email.`);
  },

  async subs() {
    const app = await appOf(args.app);
    const groups = await all(`/v1/apps/${app.id}/subscriptionGroups` + q({ limit: 50 }));
    if (!groups.length) return console.log('No subscription groups.');
    for (const g of groups) {
      console.log(`group "${g.attributes.referenceName}"  id=${g.id}`);
      for (const s of await all(`/v1/subscriptionGroups/${g.id}/subscriptions` + q({ limit: 50 }))) {
        const a = s.attributes;
        console.log(`  ${a.productId}  ${a.subscriptionPeriod}  level ${a.groupLevel}  ${a.state}  id=${s.id}`);
      }
    }
  },

  async listing() {
    const app = await appOf(args.app), locale = args.locale || 'en-US';
    const p = await listingParts(app, locale);
    if (JSON_OUT) return console.log(JSON.stringify(p, null, 2));
    const show = (k, v) => {
      const n = size(k, v), max = LIMITS[k];
      const count = max ? `  ${n}/${max}${k === 'keywords' ? ' bytes' : ''}${n > max ? '  TOO LONG' : ''}` : '';
      console.log(`  ${k}${count}\n    ${v ? String(v).replace(/\n/g, '\n    ') : '(empty)'}`);
    };
    const miss = l => l?.missing ? `  no ${locale} localization; has: ${l.missing.join(', ') || 'none'}` : null;
    console.log(`${app.attributes.name}  ${app.attributes.bundleId}  locale ${locale}`);
    console.log(`\napp info (${p.info ? stateOf(p.info.attributes) + ', editable' : 'not editable now: make a new version first'})`);
    if (miss(p.infoLoc)) console.log(miss(p.infoLoc)); else for (const k of INFO_FIELDS) show(k, p.infoLoc?.attributes?.[k]);
    if (p.edit) {
      console.log(`\nversion ${p.edit.attributes.versionString} (${stateOf(p.edit.attributes)}, editable)`);
      if (miss(p.editLoc)) console.log(miss(p.editLoc)); else for (const k of VERSION_FIELDS) show(k, p.editLoc?.attributes?.[k]);
      for (const n of keywordNotes(p.editLoc?.attributes?.keywords, p.infoLoc?.attributes?.name, p.infoLoc?.attributes?.subtitle)) console.log(`  note: ${n}`);
    } else console.log('\nno editable version. Create one in App Store Connect to change anything but promotional text.');
    if (p.live && p.liveLoc?.attributes) {
      console.log(`\nlive version ${p.live.attributes.versionString}: promotional text can change without review`);
      show('promotionalText', p.liveLoc.attributes.promotionalText);
    }
  },

  async 'listing-set'() {
    const want = JSON.parse(fs.readFileSync(need(pos[0], '<listing.json>'), 'utf8'));
    const locale = want.locale || args.locale || 'en-US';
    const app = await appOf(want.app || args.app);
    const unknown = Object.keys(want).filter(k => !['app', 'locale', ...INFO_FIELDS, ...VERSION_FIELDS].includes(k));
    if (unknown.length) throw new Error(`unknown fields: ${unknown.join(', ')}. Allowed: ${[...INFO_FIELDS, ...VERSION_FIELDS].join(', ')}`);
    const over = Object.keys(LIMITS).filter(k => want[k] != null && size(k, want[k]) > LIMITS[k]);
    if (over.length) throw new Error('too long: ' + over.map(k => `${k} ${size(k, want[k])}/${LIMITS[k]}`).join(', ') + '. Nothing sent.');
    const pick = ks => Object.fromEntries(ks.filter(k => want[k] != null).map(k => [k, want[k]]));
    const info = pick(INFO_FIELDS), version = pick(VERSION_FIELDS);
    const p = await listingParts(app, locale);
    if (Object.keys(info).length) {
      if (!p.info) throw new Error('the app info is not editable now (in review or live). Create a new version in App Store Connect, then run this again. Nothing sent.');
      if (p.infoLoc?.missing) throw new Error(`no ${locale} app info localization. Add the language in App Store Connect first. Nothing sent.`);
      await write('PATCH', `/v1/appInfoLocalizations/${p.infoLoc.id}`, { data: { type: 'appInfoLocalizations', id: p.infoLoc.id, attributes: info } });
      if (!DRY) console.log(`app info ${locale}: set ${Object.keys(info).join(', ')}`);
    }
    if (Object.keys(version).length) {
      const onlyPromo = Object.keys(version).every(k => k === 'promotionalText');
      const target = p.edit ? { v: p.edit, l: p.editLoc } : onlyPromo && p.live ? { v: p.live, l: p.liveLoc } : null;
      if (!target) throw new Error('no editable version. Create one in App Store Connect first; only promotional text can change on a live version. Nothing sent.');
      if (target.l?.missing) throw new Error(`no ${locale} localization on version ${target.v.attributes.versionString}. Nothing sent.`);
      await write('PATCH', `/v1/appStoreVersionLocalizations/${target.l.id}`, { data: { type: 'appStoreVersionLocalizations', id: target.l.id, attributes: version } });
      if (!DRY) console.log(`version ${target.v.attributes.versionString} ${locale}: set ${Object.keys(version).join(', ')}`);
    }
    if (DRY) console.log('dry run, nothing changed');
  },

  async versions() {
    const app = await appOf(args.app);
    const vs = (await all(`/v1/apps/${app.id}/appStoreVersions` + q({ 'filter[platform]': 'IOS', limit: 20 })))
      .sort((a, b) => String(b.attributes.createdDate).localeCompare(String(a.attributes.createdDate)));
    if (JSON_OUT) return console.log(JSON.stringify(vs, null, 2));
    if (!vs.length) return console.log('No App Store versions yet. Make one in App Store Connect.');
    for (const v of vs) {
      const a = v.attributes;
      console.log(`${a.versionString}  ${stateOf(a)}  release ${a.releaseType || '?'}${a.earliestReleaseDate ? ' ' + a.earliestReleaseDate : ''}  created ${String(a.createdDate || '').slice(0, 10)}  id=${v.id}`);
    }
  },

  async categories() {
    const cs = await all('/v1/appCategories' + q({ 'filter[platforms]': 'IOS', 'exists[parent]': 'false', limit: 200 }));
    if (JSON_OUT) return console.log(JSON.stringify(cs, null, 2));
    for (const c of cs) console.log(c.id);
  },

  // Read-only. One line per field on the version page, then what is missing.
  async 'review-status'() {
    const app = await appOf(args.app);
    const locale = args.locale || app.attributes.primaryLocale || 'en-US';
    const p = await versionPage(app), ip = await infoPage(app);
    const v = p.version.attributes, rows = [];
    const row = (status, what, detail = '') => rows.push({ status, what, detail });
    const has = x => x != null && String(x).trim() !== '';

    // The build, and the export question.
    if (!p.build) row('MISSING', 'build', `pick a processed TestFlight build: attach-build --app ${app.attributes.bundleId} --build <buildId>`);
    else {
      const b = await api('GET', `/v1/builds/${p.build.id}` + q({ include: 'preReleaseVersion' }));
      const ba = b.data.attributes, pre = b.included?.find(x => x.type === 'preReleaseVersions')?.attributes.version;
      const issues = [];
      if (ba.processingState !== 'VALID') issues.push(`processing state ${ba.processingState}`);
      if (ba.usesNonExemptEncryption == null) issues.push(`export compliance not answered (compliance ${p.build.id} --no-encryption)`);
      if (pre && pre !== v.versionString) issues.push(`the build is version ${pre}, the page is ${v.versionString}`);
      row(issues.length ? 'MISSING' : 'OK', 'build', `${pre || '?'} (${ba.version})` + (issues.length ? ': ' + issues.join('; ') : ', processed, export compliance answered'));
    }
    row(has(v.copyright) ? 'OK' : 'MISSING', 'copyright', v.copyright || 'for example "2026 Example Ltd"');
    row('OK', 'release', `${v.releaseType || '?'}${v.earliestReleaseDate ? ' after ' + v.earliestReleaseDate : ''}; phased release ${p.phased ? p.phased.attributes?.phasedReleaseState || 'on' : 'off'}`);

    // App Review information. Never print the demo password.
    const rd = p.review?.attributes;
    if (!rd) row('MISSING', 'review details', 'contact, notes and the demo account: version-set');
    else {
      const contact = ['contactFirstName', 'contactLastName', 'contactEmail', 'contactPhone'].filter(k => !has(rd[k]));
      row(contact.length ? 'MISSING' : 'OK', 'review contact', contact.length ? 'not set: ' + contact.join(', ') : `${rd.contactFirstName} ${rd.contactLastName}, ${rd.contactEmail}`);
      row(has(rd.notes) ? 'OK' : 'MISSING', 'review notes', has(rd.notes) ? `${[...rd.notes].length} characters` : 'how to reach every feature');
      if (rd.demoAccountRequired) row(has(rd.demoAccountName) && has(rd.demoAccountPassword) ? 'OK' : 'MISSING', 'demo account', `required; name ${has(rd.demoAccountName) ? 'set' : 'not set'}, password ${has(rd.demoAccountPassword) ? 'set' : 'not set'}`);
      else row('OK', 'demo account', 'not required (right when Sign in with Apple is the only sign-in, or there is none)');
    }

    // The store page text for one locale, and the screenshots.
    const locs = await all(`/v1/appStoreVersions/${p.version.id}/appStoreVersionLocalizations` + q({ limit: 50 }));
    const loc = locs.find(l => l.attributes.locale === locale);
    if (!loc) row('MISSING', `${locale} text`, `no ${locale} localization; has: ${locs.map(l => l.attributes.locale).join(', ') || 'none'}`);
    else {
      for (const k of ['description', 'keywords', 'supportUrl']) row(has(loc.attributes[k]) ? 'OK' : 'MISSING', k, has(loc.attributes[k]) ? '' : 'the store-listing skill writes it');
      const sets = (await api('GET', `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets` + q({ limit: 50, include: 'appScreenshots' }))).data;
      const filled = sets.filter(s => s.relationships?.appScreenshots?.data?.length);
      row(filled.length ? 'OK' : 'MISSING', 'screenshots', filled.length ? filled.map(s => `${s.attributes.screenshotDisplayType}=${s.relationships.appScreenshots.data.length}`).join(' ') : 'the app-store-screenshots skill makes them');
    }

    // App information: categories, age rating, privacy policy URL, content rights.
    if (!ip.info) row('CHECK', 'app information', 'not editable now (in review or live)');
    else {
      row(ip.primary ? 'OK' : 'MISSING', 'primary category', ip.primary?.id || 'version-set; ids from: categories');
      row('OK', 'secondary category', ip.secondary?.id || 'none (optional)');
      const un = ageUnanswered(ip.age?.attributes);
      row(ip.age && !un.length ? 'OK' : 'MISSING', 'age rating', un.length ? `${un.length} questions not answered: ${un.slice(0, 5).join(', ')}${un.length > 5 ? ', ...' : ''} (age-rating-set)` : 'all questions answered');
      const il = (await all(`/v1/appInfos/${ip.info.id}/appInfoLocalizations` + q({ limit: 50 }))).find(l => l.attributes.locale === locale);
      row(has(il?.attributes.privacyPolicyUrl) ? 'OK' : 'MISSING', 'privacy policy URL', il?.attributes.privacyPolicyUrl || 'listing-set privacyPolicyUrl');
    }
    row(app.attributes.contentRightsDeclaration ? 'OK' : 'MISSING', 'content rights', app.attributes.contentRightsDeclaration || 'version-set contentRights');

    // Price and availability: read only. A failed read is a CHECK, not a MISSING.
    for (const [what, path_, fix] of [['price', 'appPriceSchedule', 'set a price on the page for pricing and availability (Free is fine)'],
      ['availability', 'appAvailabilityV2', 'pick the countries on the page for pricing and availability']]) {
      const { r, err } = await tryApi('GET', `/v1/apps/${app.id}/${path_}`);
      if (r?.data) row('OK', what, 'set');
      else row(err === '404' || (r && !r.data) ? 'MISSING' : 'CHECK', what, err && err !== '404' ? `could not read it (${err}); ${fix}` : fix);
    }
    const groups = await all(`/v1/apps/${app.id}/subscriptionGroups` + q({ limit: 50 }));
    if (groups.length) row('CHECK', 'subscriptions', 'a first subscription goes to review with this version: select it on the version page');

    // What the API cannot see.
    row('CHECK', 'App Privacy', 'the API cannot read or set it: answer it on the App Privacy page');
    row('CHECK', 'EU trader status', 'the API cannot read or set it: see the app-store-connect-setup guide, step 8');

    const subs = await openSubmissions(app);
    if (JSON_OUT) return console.log(JSON.stringify({ app: app.attributes.bundleId, version: v.versionString, state: stateOf(v), rows, submissions: subs }, hide, 2));
    console.log(`${app.attributes.name}  ${app.attributes.bundleId}  locale ${locale}`);
    console.log(`version ${v.versionString}  ${stateOf(v)}${p.editable ? '' : '  (cannot change now)'}\n`);
    const w = Math.max(...rows.map(r => r.what.length));
    for (const r of rows) console.log(`${r.status.padEnd(8)} ${r.what.padEnd(w)}  ${r.detail}`);
    for (const s of subs) console.log(`\nreview submission ${s.attributes.state}${s.attributes.submittedDate ? ' since ' + s.attributes.submittedDate.slice(0, 16) : ''}  id=${s.id}`);
    const miss = rows.filter(r => r.status === 'MISSING').map(r => r.what), check = rows.filter(r => r.status === 'CHECK').map(r => r.what);
    console.log(`\n${miss.length ? 'Missing: ' + miss.join(', ') + '.' : 'Nothing missing that the API can see.'} Check by hand: ${check.join(', ')}.`);
  },

  async 'age-rating-set'() {
    const want = JSON.parse(fs.readFileSync(need(pos[0], '<age.json>'), 'utf8'));
    const app = await appOf(want.app || args.app);
    const attrs = { ...want }; delete attrs.app;
    const bad = [];
    for (const [k, val] of Object.entries(attrs)) {
      if (AGE_LEVEL_FIELDS.includes(k)) { if (!LEVEL.includes(val)) bad.push(`${k}: one of ${LEVEL.join(', ')}`); }
      else if (AGE_BOOL_FIELDS.includes(k)) { if (typeof val !== 'boolean') bad.push(`${k}: true or false`); }
      else if (AGE_ENUM_FIELDS[k]) { if (val !== null && !AGE_ENUM_FIELDS[k].includes(val)) bad.push(`${k}: one of ${AGE_ENUM_FIELDS[k].join(', ')}, or null`); }
      else if (k === 'developerAgeRatingInfoUrl') { if (val !== null && !/^https:\/\//.test(val)) bad.push(`${k}: an https URL`); }
      else bad.push(`${k}: not an age rating field`);
    }
    if (bad.length) throw new Error('age rating file: ' + bad.join('; ') + '. Nothing sent.');
    const ip = await infoPage(app);
    if (!ip.info) throw new Error('the app information is not editable now (in review or live). Make a new version first. Nothing sent.');
    if (!ip.age) throw new Error('no age rating declaration on the app information. Open the age rating page in App Store Connect once. Nothing sent.');
    const left = ageUnanswered({ ...ip.age.attributes, ...attrs });
    await write('PATCH', `/v1/ageRatingDeclarations/${ip.age.id}`, { data: { type: 'ageRatingDeclarations', id: ip.age.id, attributes: attrs } });
    console.log(DRY ? 'dry run, nothing changed' : `age rating: set ${Object.keys(attrs).length} answers.`);
    if (left.length) console.log(`still not answered: ${left.join(', ')}`);
  },

  async 'version-set'() {
    const want = JSON.parse(fs.readFileSync(need(pos[0], '<version.json>'), 'utf8'));
    const app = await appOf(want.app || args.app);
    const bad = Object.keys(want).filter(k => !VERSION_SET_FIELDS.includes(k)).map(k => `${k}: unknown field`);
    if (want.releaseType != null && !RELEASE_TYPES.includes(want.releaseType)) bad.push(`releaseType: one of ${RELEASE_TYPES.join(', ')}`);
    if (want.releaseType === 'SCHEDULED' && !want.earliestReleaseDate) bad.push('earliestReleaseDate: needed with SCHEDULED');
    if (want.contentRights != null && !CONTENT_RIGHTS.includes(want.contentRights)) bad.push(`contentRights: one of ${CONTENT_RIGHTS.join(', ')}`);
    if (want.phasedRelease != null && typeof want.phasedRelease !== 'boolean') bad.push('phasedRelease: true or false');
    const rv = want.review || {};
    for (const k of Object.keys(rv)) if (!REVIEW_FIELDS.includes(k)) bad.push(`review.${k}: unknown field${k === 'demoAccountPassword' ? ' (put the password in your secrets and give demoAccountPasswordRef)' : ''}`);
    if (rv.demoAccountRequired && !(rv.demoAccountName && rv.demoAccountPasswordRef)) bad.push('review: a required demo account needs demoAccountName and demoAccountPasswordRef');
    if (bad.length) throw new Error('version file: ' + bad.join('; ') + '. Nothing sent.');
    // Read the demo password before any write, so a bad reference changes nothing.
    let demoPassword;
    if (rv.demoAccountPasswordRef) {
      try { demoPassword = String(readSecret(oneboxConfig(), rv.demoAccountPasswordRef) ?? '').trim(); } catch { demoPassword = ''; }
      if (!demoPassword) throw new Error(`review.demoAccountPasswordRef "${rv.demoAccountPasswordRef}" did not resolve to a value (secrets.tool=${oneboxConfig().secrets?.tool || 'env'}). Nothing sent.`);
    }

    const p = await versionPage(app);
    editableOrStop(p);
    const vid = p.version.id, vs = p.version.attributes.versionString;
    const vattrs = Object.fromEntries(['copyright', 'releaseType', 'earliestReleaseDate'].filter(k => want[k] != null).map(k => [k, want[k]]));
    if (Object.keys(vattrs).length)
      await write('PATCH', `/v1/appStoreVersions/${vid}`, { data: { type: 'appStoreVersions', id: vid, attributes: vattrs } });

    if (want.primaryCategory || want.secondaryCategory !== undefined) {
      const ip = await infoPage(app);
      if (!ip.info) throw new Error('the app information is not editable now. Nothing more sent.');
      const rel = {};
      if (want.primaryCategory) rel.primaryCategory = { data: { type: 'appCategories', id: want.primaryCategory } };
      if (want.secondaryCategory !== undefined) rel.secondaryCategory = { data: want.secondaryCategory ? { type: 'appCategories', id: want.secondaryCategory } : null };
      await write('PATCH', `/v1/appInfos/${ip.info.id}`, { data: { type: 'appInfos', id: ip.info.id, relationships: rel } });
    }
    if (want.contentRights)
      await write('PATCH', `/v1/apps/${app.id}`, { data: { type: 'apps', id: app.id, attributes: { contentRightsDeclaration: want.contentRights } } });

    if (want.review) {
      const attributes = Object.fromEntries(REVIEW_FIELDS.filter(k => k !== 'demoAccountPasswordRef' && rv[k] != null).map(k => [k, rv[k]]));
      if (demoPassword) attributes.demoAccountPassword = demoPassword;
      if (p.review) await write('PATCH', `/v1/appStoreReviewDetails/${p.review.id}`, { data: { type: 'appStoreReviewDetails', id: p.review.id, attributes } });
      else await write('POST', '/v1/appStoreReviewDetails', { data: { type: 'appStoreReviewDetails', attributes,
        relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: vid } } } } });
    }

    if (want.phasedRelease === true && !p.phased) {
      if (!p.live) console.log('note: phased release is for updates. On a first version Apple may refuse it.');
      await write('POST', '/v1/appStoreVersionPhasedReleases', { data: { type: 'appStoreVersionPhasedReleases',
        relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: vid } } } } });
    }
    if (want.phasedRelease === false && p.phased) await write('DELETE', `/v1/appStoreVersionPhasedReleases/${p.phased.id}`);
    console.log(DRY ? 'dry run, nothing changed' : `version ${vs}: done. Read it back with review-status.`);
  },

  async 'attach-build'() {
    const app = await appOf(args.app), bid = need(args.build, '--build <buildId>');
    const p = await versionPage(app);
    editableOrStop(p);
    const b = await api('GET', `/v1/builds/${bid}` + q({ include: 'preReleaseVersion' }));
    const ba = b.data.attributes, pre = b.included?.find(x => x.type === 'preReleaseVersions')?.attributes.version;
    const vs = p.version.attributes.versionString;
    if (ba.processingState !== 'VALID' || ba.expired) throw new Error(`build ${bid} is ${ba.expired ? 'expired' : ba.processingState}. Pick a processed build (builds --app ...). Nothing sent.`);
    if (pre && pre !== vs) throw new Error(`build ${bid} is version ${pre}, but the version page is ${vs}. Build the app as version ${vs}, or change the version on the page. Nothing sent.`);
    if (ba.usesNonExemptEncryption == null) console.log(`note: build ${bid} has no export compliance answer yet. Answer it before you submit: compliance ${bid} --no-encryption (if true).`);
    await write('PATCH', `/v1/appStoreVersions/${p.version.id}/relationships/build`, { data: { type: 'builds', id: bid } });
    console.log(DRY ? 'dry run, nothing changed' : `version ${vs}: build ${pre || '?'} (${ba.version}) attached.`);
  },

  async submit() {
    const app = await appOf(args.app);
    const p = await versionPage(app);
    const vs = p.version.attributes.versionString;
    editableOrStop(p);
    if (!p.build) throw new Error(`version ${vs} has no build. Run attach-build first. Nothing sent.`);
    if (p.build.attributes && p.build.attributes.usesNonExemptEncryption == null)
      throw new Error(`the build on version ${vs} has no export compliance answer. Run compliance ${p.build.id} --no-encryption (if true) first. Nothing sent.`);
    const subs = await openSubmissions(app);
    const busy = subs.find(s => ['WAITING_FOR_REVIEW', 'IN_REVIEW', 'CANCELING', 'COMPLETING'].includes(s.attributes.state));
    if (busy) throw new Error(`a review submission is already ${busy.attributes.state} (id=${busy.id}). Wait for it, or cancel it in App Store Connect. Nothing sent.`);
    // Reuse a draft (READY_FOR_REVIEW) or a rejected one (UNRESOLVED_ISSUES). Otherwise make one.
    let sub = subs.find(s => ['READY_FOR_REVIEW', 'UNRESOLVED_ISSUES'].includes(s.attributes.state));
    if (sub) console.log(`using review submission ${sub.id} (${sub.attributes.state})`);
    else sub = (await write('POST', '/v1/reviewSubmissions', { data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' },
      relationships: { app: { data: { type: 'apps', id: app.id } } } } })).data;
    const items = sub.id === '(dry-run)' ? [] : (await api('GET', `/v1/reviewSubmissions/${sub.id}/items` + q({ include: 'appStoreVersion', limit: 50 }))).data;
    if (!items.some(i => i.relationships?.appStoreVersion?.data?.id === p.version.id))
      await write('POST', '/v1/reviewSubmissionItems', { data: { type: 'reviewSubmissionItems', relationships: {
        reviewSubmission: { data: { type: 'reviewSubmissions', id: sub.id } }, appStoreVersion: { data: { type: 'appStoreVersions', id: p.version.id } } } } });
    await write('PATCH', `/v1/reviewSubmissions/${sub.id}`, { data: { type: 'reviewSubmissions', id: sub.id, attributes: { submitted: true } } });
    console.log(DRY ? 'dry run, nothing changed' : `Version ${vs} is sent to App Review. Apple emails you when the state changes. Check it with review-status.`);
  },

  async release() {
    const app = await appOf(args.app);
    const vs = await all(`/v1/apps/${app.id}/appStoreVersions` + q({ 'filter[platform]': 'IOS', limit: 20 }));
    const v = vs.find(x => stateOf(x.attributes) === 'PENDING_DEVELOPER_RELEASE');
    if (!v) throw new Error('no version waits for you to release it (state PENDING_DEVELOPER_RELEASE). Nothing sent.');
    await write('POST', '/v1/appStoreVersionReleaseRequests', { data: { type: 'appStoreVersionReleaseRequests',
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: v.id } } } } });
    console.log(DRY ? 'dry run, nothing changed' : `Version ${v.attributes.versionString} is released. The App Store can take up to 24 hours to show it everywhere.`);
  },

  async 'subs-create'() {
    const plan = JSON.parse(fs.readFileSync(need(pos[0], '<plan.json>'), 'utf8'));
    const app = await appOf(plan.app || args.app);
    const groups = await all(`/v1/apps/${app.id}/subscriptionGroups` + q({ limit: 50 }));
    let group = groups.find(g => g.attributes.referenceName === plan.group.referenceName);
    // A re-run finishes what an earlier run left out (it may have stopped at
    // a bad locale): each step below checks what exists, by locale.
    const haveLocales = async (p) => DRY || !p ? new Set() : new Set((await all(p + q({ limit: 50 }))).map(l => l.attributes.locale));
    if (group) console.log(`group "${plan.group.referenceName}" exists, id=${group.id}`);
    else {
      group = (await write('POST', '/v1/subscriptionGroups', { data: { type: 'subscriptionGroups', attributes: { referenceName: plan.group.referenceName },
        relationships: { app: { data: { type: 'apps', id: app.id } } } } })).data;
    }
    const groupLocales = await haveLocales(group.id === '(dry-run)' ? null : `/v1/subscriptionGroups/${group.id}/subscriptionGroupLocalizations`);
    for (const l of plan.group.localizations || []) {
      if (groupLocales.has(l.locale)) continue;
      await write('POST', '/v1/subscriptionGroupLocalizations', { data: { type: 'subscriptionGroupLocalizations', attributes: l,
        relationships: { subscriptionGroup: { data: { type: 'subscriptionGroups', id: group.id } } } } });
    }
    const existing = DRY || group.id === '(dry-run)' ? [] : await all(`/v1/subscriptionGroups/${group.id}/subscriptions` + q({ limit: 50 }));
    const territories = DRY ? [] : (await all('/v1/territories' + q({ limit: 200 }))).map(t => ({ type: 'territories', id: t.id }));
    for (const s of plan.subscriptions) {
      let sub = existing.find(x => x.attributes.productId === s.productId);
      const isNew = !sub;
      if (sub) { console.log(`${s.productId} exists, id=${sub.id}: adding only what is missing`); }
      else {
        sub = (await write('POST', '/v1/subscriptions', { data: { type: 'subscriptions',
          attributes: { name: s.name, productId: s.productId, subscriptionPeriod: s.period, groupLevel: s.level, familySharable: !!s.familySharable, reviewNote: s.reviewNote },
          relationships: { group: { data: { type: 'subscriptionGroups', id: group.id } } } } })).data;
      }
      const subLocales = await haveLocales(isNew ? null : `/v1/subscriptions/${sub.id}/subscriptionLocalizations`);
      for (const l of s.localizations || []) {
        if (subLocales.has(l.locale)) continue;
        await write('POST', '/v1/subscriptionLocalizations', { data: { type: 'subscriptionLocalizations', attributes: l,
          relationships: { subscription: { data: { type: 'subscriptions', id: sub.id } } } } });
      }
      // Availability must exist before a price can be set. Without it the price POST
      // answers 409 and blames the price point.
      let available = false;
      if (!isNew && !DRY) { try { available = !!(await api('GET', `/v1/subscriptions/${sub.id}/subscriptionAvailability`))?.data; } catch { available = false; } }
      if (!available)
        await write('POST', '/v1/subscriptionAvailabilities', { data: { type: 'subscriptionAvailabilities', attributes: { availableInNewTerritories: true },
          relationships: { subscription: { data: { type: 'subscriptions', id: sub.id } }, availableTerritories: { data: DRY ? ['(all territories)'] : territories } } } });
      if (!DRY && sub.attributes?.groupLevel && s.level && sub.attributes.groupLevel !== s.level)
        await write('PATCH', `/v1/subscriptions/${sub.id}`, { data: { type: 'subscriptions', id: sub.id, attributes: { groupLevel: s.level } } });
      if (!s.price) continue;
      const terr = s.price.territory || 'USA';
      if (DRY) { console.log(`dry run: find price point ${s.price.customerPrice} in ${terr}, POST /v1/subscriptionPrices${args.equalize ? ', then one per territory from its equalizations' : ''}`); continue; }
      const points = await all(`/v1/subscriptions/${sub.id}/pricePoints` + q({ 'filter[territory]': terr, limit: 200 }));
      const pp = points.find(p => Number(p.attributes.customerPrice) === Number(s.price.customerPrice));
      if (!pp) { console.log(`  no price point ${s.price.customerPrice} in ${terr}. Nearest: ${points.map(p => p.attributes.customerPrice).slice(0, 12).join(', ')}...`); continue; }
      const price = (pointId, territory) => write('POST', '/v1/subscriptionPrices', { data: { type: 'subscriptionPrices', attributes: { preserveCurrentPrice: false },
        relationships: { subscription: { data: { type: 'subscriptions', id: sub.id } }, subscriptionPricePoint: { data: { type: 'subscriptionPricePoints', id: pointId } },
          ...(territory ? { territory: { data: { type: 'territories', id: territory } } } : {}) } } });
      await price(pp.id, terr);
      console.log(`  ${s.productId}: ${terr} ${pp.attributes.customerPrice} (proceeds ${pp.attributes.proceeds})`);
      if (args.equalize) {
        const eq = await all(`/v1/subscriptionPricePoints/${pp.id}/equalizations` + q({ include: 'territory', limit: 200 }));
        let n = 0;
        for (const e of eq) {
          const t = e.relationships?.territory?.data?.id; if (!t || t === terr) continue;
          try { await price(e.id, t); n++; } catch (err) { console.log(`  ${t}: ${err.message.slice(0, 160)}`); }
        }
        console.log(`  ${s.productId}: set ${n} equalized territory prices`);
      }
    }
    console.log(DRY ? 'dry run, nothing changed' : 'Done. Products stay MISSING_METADATA until a review screenshot of the paywall is attached (web UI).');
  },

  async call() {
    const [method, p, file] = pos; need(method, '<METHOD>'); need(p, '<path>');
    const body = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
    const r = method.toUpperCase() === 'GET' ? await api('GET', p) : await write(method.toUpperCase(), p, body);
    if (r) console.log(JSON.stringify(r, null, 2));
  },
};

(commands[cmd] ? commands[cmd]() : Promise.reject(new Error('usage: node asc.mjs <' + Object.keys(commands).join('|') + '> ... (see the header of this file)')))
  .catch(e => { console.error(e.message); process.exit(1); });
