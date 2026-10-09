#!/usr/bin/env node
// App Store Connect screenshot tool. Node 18+, no dependencies.
//
//   node asc.mjs list
//       Apps, iOS versions and state, locales, and screenshot sets with counts.
//
//   node asc.mjs replace --app <bundleId|appId> --dir <png-dir>
//       [--display APP_IPHONE_67] [--locale en-US] [--version <versionString>]
//       [--clear APP_IPHONE_67,APP_IPHONE_65] [--backup <dir>] [--dry-run]
//     1. Picks the one editable version (or --version).
//     2. Backs up every screenshot in the --clear sets to --backup, then deletes them.
//     3. Uploads <png-dir>/*.png (sorted by name) to the --display set, in order.
//     4. Waits until Apple reports every upload COMPLETE, and prints any errors.
//     --clear defaults to the --display type. --dry-run prints the plan only.
//
// Credentials: see the onebox ASC auth block below (onebox config apple.*,
// ASC_* env vars, or ~/.appstoreconnect/config.json).
// The key is only read into memory and signed locally; it is never printed.
import fs from 'fs'; import path from 'path'; import os from 'os'; import crypto from 'crypto';
import { readSecret } from './secret.mjs';

const EDITABLE = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'];

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

const args = Object.fromEntries(process.argv.slice(3).reduce((a, x, i, all) => {
  if (x.startsWith('--')) a.push([x.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]); return a; }, []));

async function versionsOf(appId) {
  return (await api('GET', `/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=10`)).data;
}
async function setsOf(locId) {
  return (await api('GET', `/v1/appStoreVersionLocalizations/${locId}/appScreenshotSets?limit=50&include=appScreenshots`)).data;
}

async function list() {
  const apps = (await api('GET', '/v1/apps?limit=200&fields[apps]=name,bundleId')).data;
  for (const a of apps) {
    console.log(`${a.attributes.name}  ${a.attributes.bundleId}  id=${a.id}`);
    for (const v of await versionsOf(a.id)) {
      const st = v.attributes.appStoreState, edit = EDITABLE.includes(st);
      console.log(`  ${v.attributes.versionString}  ${st}${edit ? '  (editable)' : ''}`);
      if (!edit) continue;
      const locs = (await api('GET', `/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations?limit=50`)).data;
      for (const l of locs) {
        const sets = await setsOf(l.id);
        console.log(`    ${l.attributes.locale}: ` + (sets.map(s => `${s.attributes.screenshotDisplayType}=${s.relationships.appScreenshots.data.length}`).join('  ') || 'no screenshots'));
      }
    }
  }
}

async function replace() {
  const display = args.display || 'APP_IPHONE_67', locale = args.locale || 'en-US';
  const clear = (args.clear || display).split(',');
  const dir = path.resolve(args.dir || ''); const dry = !!args['dry-run'];
  if (!args.app || !fs.existsSync(dir)) throw new Error('--app and an existing --dir are required');
  const files = fs.readdirSync(dir).filter(f => /\.(png|jpe?g)$/i.test(f)).sort();
  if (!files.length || files.length > 10) throw new Error(`Need 1-10 images in ${dir}, found ${files.length}`);

  const q = /^\d+$/.test(args.app) ? `/v1/apps/${args.app}` : `/v1/apps?filter[bundleId]=${encodeURIComponent(args.app)}`;
  const res = await api('GET', q); const app = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!app) throw new Error('App not found: ' + args.app);
  const vs = (await versionsOf(app.id)).filter(v => args.version ? v.attributes.versionString === args.version : EDITABLE.includes(v.attributes.appStoreState));
  if (vs.length !== 1) throw new Error(`Expected one editable version, found ${vs.length}: ${vs.map(v => v.attributes.versionString).join(', ')}. Pass --version.`);
  const v = vs[0];
  const loc = (await api('GET', `/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations?limit=50`)).data.find(l => l.attributes.locale === locale);
  if (!loc) throw new Error(`No ${locale} localization on ${v.attributes.versionString}`);
  const sets = await setsOf(loc.id);
  const toClear = sets.filter(s => clear.includes(s.attributes.screenshotDisplayType));

  console.log(`${app.attributes.name} ${v.attributes.versionString} (${v.attributes.appStoreState}) ${locale}`);
  for (const s of toClear) console.log(`  clear ${s.attributes.screenshotDisplayType}: ${s.relationships.appScreenshots.data.length} screenshots`);
  console.log(`  upload ${files.length} to ${display}: ${files.join(', ')}`);
  if (dry) return console.log('  dry run, nothing changed');

  const backup = path.resolve(args.backup || path.join(dir, '..', 'asc-backup'));
  for (const s of toClear) {
    const shots = (await api('GET', `/v1/appScreenshotSets/${s.id}/appScreenshots?limit=50`)).data;
    const bdir = path.join(backup, app.attributes.bundleId, s.attributes.screenshotDisplayType); fs.mkdirSync(bdir, { recursive: true });
    for (const [i, sh] of shots.entries()) {
      const a = sh.attributes.imageAsset; if (!a) continue;
      const r = await fetch(a.templateUrl.replace('{w}', a.width).replace('{h}', a.height).replace('{f}', 'png'));
      if (!r.ok) throw new Error('Backup download failed; nothing deleted.');
      fs.writeFileSync(path.join(bdir, `${String(i + 1).padStart(2, '0')}-${sh.attributes.fileName.replace(/\.[^.]+$/, '')}.png`), Buffer.from(await r.arrayBuffer()));
    }
    console.log(`  backed up ${shots.length} -> ${bdir}`);
    for (const sh of shots) await api('DELETE', `/v1/appScreenshots/${sh.id}`);
    console.log(`  deleted ${shots.length} from ${s.attributes.screenshotDisplayType}`);
  }

  let set = sets.find(s => s.attributes.screenshotDisplayType === display);
  if (!set) set = (await api('POST', '/v1/appScreenshotSets', { data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: display },
    relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: loc.id } } } } })).data;
  const ids = [];
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    const sh = (await api('POST', '/v1/appScreenshots', { data: { type: 'appScreenshots', attributes: { fileName: f, fileSize: buf.length },
      relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } } } })).data;
    for (const op of sh.attributes.uploadOperations) {
      const r = await fetch(op.url, { method: op.method, headers: Object.fromEntries(op.requestHeaders.map(h => [h.name, h.value])), body: buf.subarray(op.offset, op.offset + op.length) });
      if (!r.ok) throw new Error(`Part upload failed for ${f}: ${r.status}`);
    }
    await api('PATCH', `/v1/appScreenshots/${sh.id}`, { data: { type: 'appScreenshots', id: sh.id,
      attributes: { uploaded: true, sourceFileChecksum: crypto.createHash('md5').update(buf).digest('hex') } } });
    ids.push(sh.id); console.log(`  uploaded ${f}`);
  }
  await api('PATCH', `/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, { data: ids.map(id => ({ type: 'appScreenshots', id })) });

  for (let round = 0; round < 30; round++) {
    const shots = (await api('GET', `/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`)).data;
    const states = shots.map(s => s.attributes.assetDeliveryState?.state);
    const failed = shots.filter(s => s.attributes.assetDeliveryState?.state === 'FAILED');
    if (failed.length) throw new Error('Processing failed: ' + failed.map(s => s.attributes.fileName + ' ' + JSON.stringify(s.attributes.assetDeliveryState.errors)).join('\n'));
    if (states.every(s => s === 'COMPLETE')) return console.log(`  ${shots.length} in ${display}, all COMPLETE, order: ${shots.map(s => s.attributes.fileName).join(', ')}`);
    await new Promise(r => setTimeout(r, 8000));
  }
  console.log('  still processing after 4 minutes; run `list` later to check');
}

const cmd = process.argv[2];
(cmd === 'list' ? list() : cmd === 'replace' ? replace() : Promise.reject(new Error('usage: asc.mjs list | replace --app ... --dir ...')))
  .catch(e => { console.error(e.message); process.exit(1); });
