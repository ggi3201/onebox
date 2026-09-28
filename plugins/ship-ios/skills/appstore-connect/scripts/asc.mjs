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
//   node asc.mjs get     <path>                         any GET, e.g. '/v1/apps?limit=5'
//
// Write commands (all take --dry-run, which prints the request and changes nothing):
//   node asc.mjs expire      <buildId>
//   node asc.mjs compliance  <buildId> --no-encryption  answer the export question for one build
//   node asc.mjs add-build   --group <groupId> --build <buildId>
//   node asc.mjs add-tester  --group <groupId> --email <email> [--first A --last B]
//   node asc.mjs subs-create <plan.json> [--equalize]  subscription group + products, see api.md
//   node asc.mjs listing-set <listing.json> --app <bundleId|appId>  store page text, see api.md
//   node asc.mjs call        <METHOD> <path> [body.json]
//
// Output is plain text. Add --json to any read command for the raw API answer.
// The private key is read into memory and signed locally. It is never printed.
import fs from 'fs'; import path from 'path'; import os from 'os'; import crypto from 'crypto';
import { execFileSync } from 'child_process';

// ---- onebox ASC auth ------------------------------------------------------
// This block is identical in ship-ios/skills/appstore-connect/scripts/asc.mjs
// and ship-ios/skills/app-store-screenshots/scripts/asc.mjs, so each skill
// installs on its own. Change both or neither.
//
// Credentials, first match wins:
//   1. ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH (or ASC_PRIVATE_KEY, the .p8 text)
//   2. onebox config: apple.ascKeyId, apple.ascIssuerId, and apple.ascKeyPath
//      or apple.ascKeyRef (a secret reference read with secrets.tool)
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
function dotenvValue(name) {
  for (let d = process.cwd(); ; d = path.dirname(d)) {
    const f = path.join(d, '.env');
    if (fs.existsSync(f)) {
      const m = fs.readFileSync(f, 'utf8').match(new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`, 'm'));
      if (m) return m[1].trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
    }
    if (path.dirname(d) === d) return undefined;
  }
}
function readSecret(ref, cfg) {
  const tool = cfg.secrets?.tool || 'env';
  if (tool === 'doppler') {
    const d = cfg.secrets?.doppler || {};
    const args = ['secrets', 'get', ref, '--plain'];
    if (d.project) args.push('-p', d.project);
    if (d.config) args.push('-c', d.config);
    return execFileSync('doppler', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  }
  if (tool === '1password') return execFileSync('op', ['read', ref], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  return process.env[ref] ?? dotenvValue(ref);
}
function ascCreds() {
  const home = p => (p || '').replace(/^~(?=$|\/)/, os.homedir());
  const pem = s => s && s.replace(/\\n/g, '\n').trim() + '\n';
  const e = process.env;
  if (e.ASC_KEY_ID && e.ASC_ISSUER_ID && (e.ASC_KEY_PATH || e.ASC_PRIVATE_KEY))
    return { keyId: e.ASC_KEY_ID, issuer: e.ASC_ISSUER_ID, key: e.ASC_PRIVATE_KEY ? pem(e.ASC_PRIVATE_KEY) : fs.readFileSync(home(e.ASC_KEY_PATH)) };
  const cfg = oneboxConfig(), a = cfg.apple || {};
  if (a.ascKeyId && a.ascIssuerId && (a.ascKeyPath || a.ascKeyRef)) {
    const key = a.ascKeyPath ? fs.readFileSync(home(a.ascKeyPath)) : pem(readSecret(a.ascKeyRef, cfg));
    if (!key || !String(key).includes('PRIVATE KEY')) throw new Error(`apple.ascKeyRef "${a.ascKeyRef}" did not resolve to a .p8 key (secrets.tool=${cfg.secrets?.tool || 'env'}).`);
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

async function write(method, p, body) {
  if (DRY) { console.log(`dry run: ${method} ${p}` + (body ? '\n' + JSON.stringify(body, null, 2) : '')); return { data: { id: '(dry-run)' } }; }
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
  const a = Array.isArray(r.data) ? r.data.find(x => x.attributes.bundleId === ref) || r.data[0] : r.data;
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

  async 'subs-create'() {
    const plan = JSON.parse(fs.readFileSync(need(pos[0], '<plan.json>'), 'utf8'));
    const app = await appOf(plan.app || args.app);
    const groups = await all(`/v1/apps/${app.id}/subscriptionGroups` + q({ limit: 50 }));
    let group = groups.find(g => g.attributes.referenceName === plan.group.referenceName);
    if (group) console.log(`group "${plan.group.referenceName}" exists, id=${group.id}`);
    else {
      group = (await write('POST', '/v1/subscriptionGroups', { data: { type: 'subscriptionGroups', attributes: { referenceName: plan.group.referenceName },
        relationships: { app: { data: { type: 'apps', id: app.id } } } } })).data;
      for (const l of plan.group.localizations || [])
        await write('POST', '/v1/subscriptionGroupLocalizations', { data: { type: 'subscriptionGroupLocalizations', attributes: l,
          relationships: { subscriptionGroup: { data: { type: 'subscriptionGroups', id: group.id } } } } });
    }
    const existing = DRY || group.id === '(dry-run)' ? [] : await all(`/v1/subscriptionGroups/${group.id}/subscriptions` + q({ limit: 50 }));
    const territories = DRY ? [] : (await all('/v1/territories' + q({ limit: 200 }))).map(t => ({ type: 'territories', id: t.id }));
    for (const s of plan.subscriptions) {
      let sub = existing.find(x => x.attributes.productId === s.productId);
      if (sub) { console.log(`${s.productId} exists, id=${sub.id}, skipping create`); }
      else {
        sub = (await write('POST', '/v1/subscriptions', { data: { type: 'subscriptions',
          attributes: { name: s.name, productId: s.productId, subscriptionPeriod: s.period, groupLevel: s.level, familySharable: !!s.familySharable, reviewNote: s.reviewNote },
          relationships: { group: { data: { type: 'subscriptionGroups', id: group.id } } } } })).data;
        for (const l of s.localizations || [])
          await write('POST', '/v1/subscriptionLocalizations', { data: { type: 'subscriptionLocalizations', attributes: l,
            relationships: { subscription: { data: { type: 'subscriptions', id: sub.id } } } } });
        // Availability must exist before a price can be set. Without it the price POST
        // answers 409 and blames the price point.
        await write('POST', '/v1/subscriptionAvailabilities', { data: { type: 'subscriptionAvailabilities', attributes: { availableInNewTerritories: true },
          relationships: { subscription: { data: { type: 'subscriptions', id: sub.id } }, availableTerritories: { data: DRY ? ['(all territories)'] : territories } } } });
      }
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
