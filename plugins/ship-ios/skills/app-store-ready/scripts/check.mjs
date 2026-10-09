#!/usr/bin/env node
// Static App Store readiness check for an Expo / React Native app.
//
//   node check.mjs [app-dir] [--json] [--no-expo] [--offline]
//
// Reads the resolved app config (`npx expo config --type introspect --json`,
// falling back to app.json), eas.json, package.json and the source tree.
// Prints one line per check: OK, FIX (needs fixing), BLOCKED (will stop the
// upload, TestFlight or review), or CHECK (cannot be seen from the repo; check
// by hand). The ids match references/checklist.md.
//
// It changes nothing and sends nothing anywhere. Its one network use is a plain
// GET of the app's privacy and support pages, when it knows their URLs and the
// repo has no source for them. --offline skips that. Node 18+, no dependencies.
import fs from 'fs'; import os from 'os'; import path from 'path'; import { execFileSync } from 'child_process'; import zlib from 'zlib';

const argv = process.argv.slice(2);
const DIR = path.resolve(argv.find(a => !a.startsWith('--')) || '.');
const JSON_OUT = argv.includes('--json'), NO_EXPO = argv.includes('--no-expo'), OFFLINE = argv.includes('--offline');
const results = [];
const add = (id, status, msg, fix) => results.push({ id, status, msg, fix });
const exists = f => fs.existsSync(path.join(DIR, f));
const gitIgnored = f => { try { execFileSync('git', ['check-ignore', '-q', f], { cwd: DIR, stdio: 'ignore' }); return true; } catch { return false; } };
const readJson = f => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };

// ---- Load --------------------------------------------------------------------
const pkg = readJson('package.json') || {};
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const has = (...names) => names.some(n => deps[n]);
const eas = readJson('eas.json');

let expo = null, configSource = 'app.json';
if (!NO_EXPO) {
  // Prefer the project's own expo binary (walking up for monorepos), then npx.
  let bin = null;
  for (let d = DIR; ; d = path.dirname(d)) {
    const b = path.join(d, 'node_modules', '.bin', 'expo');
    if (fs.existsSync(b)) { bin = b; break; }
    if (path.dirname(d) === d) break;
  }
  const [exe, pre] = bin ? [bin, []] : ['npx', ['--no-install', 'expo']];
  for (const type of ['introspect', 'public']) {
    try {
      const out = execFileSync(exe, [...pre, 'config', '--type', type, '--json'],
        { cwd: DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120000 });
      expo = JSON.parse(out.slice(out.indexOf('{'))); configSource = `expo config --type ${type}`; break;
    } catch {}
  }
}
if (!expo) {
  const a = readJson('app.json'); expo = a?.expo || a;
  if (['app.config.js', 'app.config.ts', 'app.config.mjs', 'app.config.cjs'].some(exists))
    console.error('Note: app.config.* exists but could not be evaluated (is expo installed here?). Results use app.json only and may be wrong.\n');
}
if (!expo) {
  console.error(`No Expo app config found in ${DIR}. Run this from the app folder (the one with app.json or app.config.*).`);
  process.exit(2);
}
const ios = expo.ios || {};
const plist = ios.infoPlist || {};

// Source files: app code only.
const SKIP = new Set(['node_modules', '.git', 'ios', 'android', 'build', 'dist', '.expo', 'coverage', '__tests__', '__mocks__', 'web-build']);
const files = [];
(function walk(d, depth) {
  if (depth > 8) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, depth + 1); }
    else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(e.name) && !/\.(test|spec|stories)\./.test(e.name)) files.push(p);
  }
})(DIR, 0);
// Comments are blanked (newlines kept, so line numbers stay right): a comment that
// explains why localhost is refused is not a localhost URL.
const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const src = files.map(f => ({ f: path.relative(DIR, f), t: stripComments(fs.readFileSync(f, 'utf8')) }));
const grep = (re, filter = () => true) => src.filter(s => filter(s.f)).flatMap(s => {
  const out = []; const lines = s.t.split('\n');
  lines.forEach((l, i) => { if (re.test(l)) out.push(`${s.f}:${i + 1}`); });
  return out;
});
const anySrc = re => src.some(s => re.test(s.t));
const first = (arr, n = 3) => arr.slice(0, n).join(', ') + (arr.length > n ? ` (+${arr.length - n} more)` : '');

// ---- Identity and versions ------------------------------------------------------
const bid = ios.bundleIdentifier;
if (!bid) add('bundle-id', 'BLOCKED', 'ios.bundleIdentifier is not set.', 'Set a reverse-DNS ID you own, e.g. com.yourname.myapp. It is permanent once the app is on the store.');
else if (/^(com\.example|com\.anonymous|host\.exp|org\.reactjs)/i.test(bid) || /example|test|demo/i.test(bid.split('.').pop()))
  add('bundle-id', 'FIX', `Bundle ID looks like a placeholder: ${bid}`, 'Choose the final ID before creating the App Store Connect record. It cannot be changed later.');
else add('bundle-id', 'OK', `Bundle ID ${bid}`);

if (!expo.name) add('name', 'FIX', 'expo.name is empty.');
else if (expo.name.length > 12) add('name', 'FIX', `Home screen name "${expo.name}" is ${expo.name.length} characters; iOS truncates it at about 12.`, 'Keep expo.name short. The App Store name (up to 30 characters) is set separately in App Store Connect.');
else add('name', 'OK', `Home screen name "${expo.name}"`);

if (!/^\d+(\.\d+){0,2}$/.test(expo.version || '')) add('version', 'FIX', `expo.version is "${expo.version || ''}".`, 'Use 1.0.0 style. Bump it for every App Store release.');
else add('version', 'OK', `Version ${expo.version}. Bump it for each release; a version already live or in review is rejected at upload.`);

const remote = eas?.cli?.appVersionSource === 'remote';
const prodProfile = eas?.build?.production;
if (remote && prodProfile?.autoIncrement) add('build-number', 'OK', 'EAS manages the build number (appVersionSource remote + autoIncrement).');
else if (remote) add('build-number', 'FIX', 'appVersionSource is remote but the production profile has no autoIncrement.', 'Add "autoIncrement": true to build.production in eas.json.');
else if (ios.buildNumber) add('build-number', 'FIX', `Build number ${ios.buildNumber} is managed by hand.`, 'Every upload needs a higher build number. Set cli.appVersionSource "remote" and autoIncrement in eas.json, or bump ios.buildNumber every time.');
else add('build-number', 'FIX', 'No build number strategy.', 'Set "cli": {"appVersionSource": "remote"} and "autoIncrement": true on the production profile in eas.json.');

// ---- Icon and splash --------------------------------------------------------------
function pngInfo(p) {
  try {
    const b = fs.readFileSync(p);
    if (b.readUInt32BE(0) !== 0x89504e47) return null;
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20), depth = b[24], ct = b[25];
    // An RGBA file whose every pixel is opaque is fine: App Store Connect
    // rejects real transparency, not the channel. So read the pixels.
    const alpha = b.includes(Buffer.from('tRNS')) || ((ct === 4 || ct === 6) && !allOpaque(b, w, h, depth, ct));
    return { w, h, alpha };
  } catch { return null; }
}
// True when every alpha byte is 255. 8-bit greyscale+alpha or RGBA only;
// anything else counts as not opaque, the safe answer.
function allOpaque(b, w, h, depth, ct) {
  if (depth !== 8) return false;
  const idat = [];
  for (let o = 8; o + 8 <= b.length;) {
    const len = b.readUInt32BE(o), type = b.toString('latin1', o + 4, o + 8);
    if (type === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len));
    if (type === 'IEND') break;
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = ct === 6 ? 4 : 2, stride = w * bpp;
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, up = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      cur[x] = v & 255;
    }
    for (let x = bpp - 1; x < stride; x += bpp) if (cur[x] !== 255) return false;
    [prev, cur] = [cur, prev];
  }
  return true;
}
// ios.icon is a path, or { light, dark, tinted } for the iOS 18 variants.
const iconPath = typeof ios.icon === 'string' ? ios.icon : (ios.icon?.light || expo.icon);
if (!iconPath) add('icon', 'BLOCKED', 'No app icon (expo.icon or ios.icon).', 'Add a 1024x1024 opaque PNG, or an Icon Composer .icon folder. See the draw-app-icon skill.');
else if (/\.icon\/?$/.test(iconPath)) {
  add('icon', exists(iconPath) ? 'OK' : 'BLOCKED', `Icon Composer icon ${iconPath}${exists(iconPath) ? '' : ' is missing'}`);
  if (expo.icon && expo.icon !== iconPath) { const i = pngInfo(path.join(DIR, expo.icon)); if (i?.alpha) add('icon-fallback', 'FIX', `Fallback icon ${expo.icon} has an alpha channel.`, 'Export the 1024 px fallback without transparency.'); }
} else {
  const i = pngInfo(path.join(DIR, iconPath));
  if (!i) add('icon', 'BLOCKED', `Icon ${iconPath} is missing or not a PNG.`);
  else if (i.w !== 1024 || i.h !== 1024) add('icon', 'FIX', `Icon ${iconPath} is ${i.w}x${i.h}.`, 'Use exactly 1024x1024.');
  else if (i.alpha) add('icon', 'FIX', `Icon ${iconPath} has an alpha channel. App Store Connect rejects a 1024 px icon with alpha; Expo flattens it onto white at build time, so any transparent area turns white.`, 'Export it opaque, on its real background colour.');
  else add('icon', 'OK', `Icon ${iconPath} 1024x1024, opaque`);
}
const splash = expo.splash || ios.splash || (expo.plugins || []).some(p => (Array.isArray(p) ? p[0] : p) === 'expo-splash-screen');
add('splash', splash ? 'OK' : 'FIX', splash ? 'Splash screen configured' : 'No splash screen configured; the app opens on a blank screen.', splash ? undefined : 'Configure the expo-splash-screen plugin with your logo and background colour.');

// ---- Permission strings ------------------------------------------------------------
const PERMS = [
  [['expo-camera', 'react-native-vision-camera', 'expo-barcode-scanner'], 'NSCameraUsageDescription'],
  [['expo-image-picker'], 'NSPhotoLibraryUsageDescription'],
  [['expo-media-library'], 'NSPhotoLibraryUsageDescription'],
  [['expo-location'], 'NSLocationWhenInUseUsageDescription'],
  [['expo-contacts'], 'NSContactsUsageDescription'],
  [['expo-calendar'], 'NSCalendarsUsageDescription'],
  [['expo-av', 'expo-audio', 'expo-speech-recognition', '@react-native-voice/voice'], 'NSMicrophoneUsageDescription'],
  [['expo-speech-recognition', '@react-native-voice/voice'], 'NSSpeechRecognitionUsageDescription'],
  [['expo-local-authentication'], 'NSFaceIDUsageDescription'],
  [['expo-tracking-transparency'], 'NSUserTrackingUsageDescription'],
  [['react-native-health', '@kingstinct/react-native-healthkit'], 'NSHealthShareUsageDescription'],
  [['expo-sensors'], 'NSMotionUsageDescription'],
  [['react-native-ble-plx'], 'NSBluetoothAlwaysUsageDescription'],
];
// Generic = Expo's default text, too short, or no "to/so/for/when <purpose>" clause.
// "Scan a recipe from a cookbook page with your camera." passes: it says what
// the app does. "This app needs access to your camera." does not.
const isGeneric = v => /\$\(PRODUCT_NAME\)|lorem|todo/i.test(v) || v.trim().length < 30
  || (/\b(needs?|requires?|uses?|would like)\b.*\b(access|permission)\b/i.test(v) && !/\b(to|so|for|when|while)\s+\w+(\s+\w+){2,}/i.test(v));
const usage = Object.entries(plist).filter(([k]) => /^NS\w+UsageDescription$/.test(k));
for (const [pkgs, key] of PERMS) {
  const used = pkgs.filter(p => deps[p]);
  if (!used.length) continue;
  if (!plist[key]) add('purpose-' + key, key === 'NSUserTrackingUsageDescription' || key === 'NSCameraUsageDescription' ? 'BLOCKED' : 'FIX',
    `${used.join(', ')} is installed but ${key} is not set${configSource.includes('introspect') ? '' : ' (plugins may add it; run with expo installed to see)'}.`,
    `Add ios.infoPlist.${key} (or the plugin's permission option) with a sentence that says what the app does with it. A missing string crashes the app on access and fails upload (ITMS-90683).`);
}
for (const [k, v] of usage) {
  if (isGeneric(String(v)))
    add('purpose-text', 'FIX', `${k} is generic: "${String(v).slice(0, 80)}"`, 'Say what the app does with it, e.g. "Scan a recipe from a cookbook page with your camera." Generic strings are a common 5.1.1 rejection.');
}
if (usage.length && !results.some(r => r.id === 'purpose-text')) add('purpose-text', 'OK', `${usage.length} permission strings, none generic`);

// ---- Export compliance, privacy manifest, tracking --------------------------------------
const enc = ios.config?.usesNonExemptEncryption ?? plist.ITSAppUsesNonExemptEncryption;
if (enc === undefined) add('export-compliance', 'FIX', 'ITSAppUsesNonExemptEncryption is not set. Every build will wait in TestFlight as "Missing Compliance" until someone answers by hand.',
  'If the app only uses HTTPS, the keychain and OS crypto, set "ios": {"config": {"usesNonExemptEncryption": false}}. Custom or non-standard crypto needs the real answer.');
else add('export-compliance', 'OK', `usesNonExemptEncryption = ${enc}`);

const pm = ios.privacyManifests;
const reasons = (pm?.NSPrivacyAccessedAPITypes || []).map(x => x.NSPrivacyAccessedAPIType);
if (!pm) add('privacy-manifest', 'FIX', 'No ios.privacyManifests. Apple rejects uploads that use required-reason APIs without declared reasons (ITMS-91053).',
  'Add ios.privacyManifests.NSPrivacyAccessedAPITypes. React Native apps nearly always need UserDefaults (CA92.1), FileTimestamp (C617.1), SystemBootTime (35F9.1) and DiskSpace (E174.1); copy extra ones from your dependencies\' PrivacyInfo files. See references/checklist.md.');
else {
  const want = ['NSPrivacyAccessedAPICategoryUserDefaults', 'NSPrivacyAccessedAPICategoryFileTimestamp', 'NSPrivacyAccessedAPICategorySystemBootTime', 'NSPrivacyAccessedAPICategoryDiskSpace'];
  const miss = want.filter(w => !reasons.includes(w));
  add('privacy-manifest', miss.length ? 'FIX' : 'OK', miss.length ? `Privacy manifest lacks ${miss.map(m => m.replace('NSPrivacyAccessedAPICategory', '')).join(', ')}` : `Privacy manifest declares ${reasons.length} API types`,
    miss.length ? 'Most React Native apps touch these. Confirm with your dependencies\' PrivacyInfo files, then add them.' : undefined);
}

const TRACKERS = ['react-native-fbsdk-next', '@react-native-firebase/analytics', 'react-native-appsflyer', 'react-native-adjust', 'react-native-branch', 'react-native-google-mobile-ads', '@amplitude/analytics-react-native', 'react-native-singular', 'mixpanel-react-native'];
const trackers = TRACKERS.filter(t => deps[t]);
const att = has('expo-tracking-transparency') || plist.NSUserTrackingUsageDescription;
if (trackers.length && !att) add('att', 'FIX', `Tracking/ads SDKs (${trackers.join(', ')}) but no App Tracking Transparency.`, 'If any of them tracks across apps, ask with expo-tracking-transparency before it starts, and declare tracking in App Privacy (5.1.2(i)). If none tracks, configure them so and say so in App Privacy.');
else if (!trackers.length && att) add('att', 'FIX', 'App Tracking Transparency is set up but no tracking SDK was found.', 'Do not show the tracking prompt if you do not track. It is a rejection risk and it confuses users.');
else add('att', 'OK', trackers.length ? 'Tracking SDKs and ATT both present; check the prompt runs before tracking' : 'No tracking SDKs, no ATT prompt');

// ---- Accounts ----------------------------------------------------------------------
// expo-auth-session alone is not social login: it also links other accounts. googleUse/fbUse catch its Google and Facebook use.
const social = ['@react-native-google-signin/google-signin', 'react-native-fbsdk-next'].filter(d => deps[d]);
const apple = has('expo-apple-authentication', '@invertase/react-native-apple-authentication');
const googleUse = anySrc(/GoogleSignin|signInWithGoogle|Google\.useAuthRequest|provider:\s*['"]google/i);
const fbUse = anySrc(/LoginManager|Facebook\.useAuthRequest|signInWithFacebook/i);
if ((googleUse || fbUse || social.length) && !apple)
  add('sign-in-with-apple', 'BLOCKED', 'Social login found (Google/Facebook) but no Sign in with Apple.', 'Guideline 4.8: offer an equivalent login that limits data collection. Sign in with Apple is the usual answer: expo-apple-authentication + "ios.usesAppleSignIn": true.');
else if (apple && !ios.usesAppleSignIn)
  add('sign-in-with-apple', 'CHECK', 'expo-apple-authentication is installed but ios.usesAppleSignIn is not set.', 'Its config plugin adds the Sign in with Apple entitlement. Set "ios": {"usesAppleSignIn": true} as well, as Expo\'s docs show, so the capability is plain to see.');
else if (apple) add('sign-in-with-apple', 'OK', 'Sign in with Apple enabled');

if (apple) {
  const handRolled = grep(/>\s*(Continue|Sign in|Sign up|Log in) with Apple\s*<|['"`](Continue|Sign in|Sign up|Log in) with Apple['"`]/i, f => /\.(tsx|jsx)$/.test(f))
    .filter(l => !src.find(s => s.f === l.split(':')[0])?.t.includes('AppleAuthenticationButton'));
  if (handRolled.length) add('apple-button', 'FIX', `Text "… with Apple" outside AppleAuthenticationButton: ${first(handRolled)}`, 'Use the system AppleAuthenticationButton. A styled lookalike breaks Apple\'s button rules and gets rejected.');
}

// Not a bare "register": registerRootComponent and registerForPushNotificationsAsync are in most apps.
const accountLike = apple || googleUse || fbUse || anySrc(/sign ?up|signUp|register(User|Account)\b|createAccount|createUser|createUserWithEmailAndPassword|supabase\.auth\.|auth\(\)\.|clerk|@clerk\//i);
const deletion = anySrc(/delete ?(my )?(account|data|profile)|deleteAccount|deleteUser|removeAccount|account.?deletion/i);
if (accountLike && !deletion) add('account-deletion', 'BLOCKED', 'The app creates accounts but no account deletion was found in the code.', 'Guideline 5.1.1(v): offer "Delete account" inside the app, two taps or so from settings. It must really delete the data. See references/checklist.md.');
else if (accountLike) add('account-deletion', 'OK', 'Account deletion found. Check it really deletes server data, revokes Apple tokens, and covers guest accounts too.');

// The privacy policy and the support page must say how to delete the account (5.1.1(v)).
// Each page is read from its source in a site folder of this repo, else from its live URL.
if (accountLike && deletion) await checkDeletionPages();
async function checkDeletionPages() {
  const WORDING = 'https://onebox.lokkesveen.com/guides/privacy-and-support-pages.md';
  const mentions = t => /\b(delet|remov|eras)\w*\b[^.!?\n]{0,60}\baccount|\baccount\b[^.!?\n]{0,60}\b(delet|remov|eras)\w*/i.test(t);
  const toText = t => t.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/\{\s*['"`]\s*['"`]\s*\}/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');

  // URLs: the app config's extra, the onebox config (app.privacyUrl, app.supportUrl),
  // listing.json for the appstore-connect skill, then a link in the app code.
  const urls = { privacy: [], support: [] };
  const isUrl = v => typeof v === 'string' && /^https?:\/\/[^\s]+$/.test(v);
  (function flat(o) {
    for (const [k, v] of Object.entries(o || {})) {
      if (v && typeof v === 'object') flat(v);
      else if (isUrl(v) && /privacy/i.test(k)) urls.privacy.push(v);
      else if (isUrl(v) && /support/i.test(k)) urls.support.push(v);
    }
  })(expo.extra);
  const readAny = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
  let projectCfg = {};
  for (let d = DIR; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.onebox.json'))) { projectCfg = readAny(path.join(d, '.onebox.json')); break; }
    if (fs.existsSync(path.join(d, '.git')) || path.dirname(d) === d) break;
  }
  const userCfg = readAny(path.join(os.homedir(), '.config', 'onebox', 'config.json'));
  for (const c of [projectCfg, userCfg]) {
    if (isUrl(c.app?.privacyUrl)) urls.privacy.push(c.app.privacyUrl);
    if (isUrl(c.app?.supportUrl)) urls.support.push(c.app.supportUrl);
  }
  const listing = readJson('listing.json') || {};
  if (isUrl(listing.privacyPolicyUrl)) urls.privacy.push(listing.privacyPolicyUrl);
  if (isUrl(listing.supportUrl)) urls.support.push(listing.supportUrl);
  for (const s of src) for (const m of s.t.matchAll(/['"`](https:\/\/[^\s'"`$]+)['"`]/g)) {
    if (/privacy/i.test(m[1])) urls.privacy.push(m[1]);
    else if (/\/(support|help)\b/i.test(m[1])) urls.support.push(m[1]);
  }

  // Page sources: a site folder in the repo (the same names /start:plan looks for).
  let root = DIR;
  for (let d = DIR, i = 0; i < 6; d = path.dirname(d), i++) {
    if (fs.existsSync(path.join(d, '.git'))) { root = d; break; }
    if (path.dirname(d) === d) break;
  }
  const SITE_NAMES = /^(site|web|www|website|landing|landing-page|marketing|homepage)$/;
  const SITE_CONFIGS = ['astro.config.mjs', 'astro.config.ts', 'next.config.js', 'next.config.mjs', 'next.config.ts'];
  const NOT_SITE = new Set([...SKIP, '.next', 'out', '.astro', 'public', 'static', 'assets']);
  const sites = [];
  (function findSites(d, depth) {
    if (depth > 3) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.') || NOT_SITE.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (p === DIR) continue;
      const isSite = SITE_CONFIGS.some(f => fs.existsSync(path.join(p, f)))
        || (SITE_NAMES.test(e.name) && ['package.json', 'index.html'].some(f => fs.existsSync(path.join(p, f))));
      if (isSite) sites.push(p); else findSites(p, depth + 1);
    }
  })(root, 0);
  const pageFiles = (site, re) => {
    const out = [];
    (function walkSite(d, depth) {
      if (depth > 6) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith('.') || NOT_SITE.has(e.name)) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walkSite(p, depth + 1);
        else if (/\.(tsx?|jsx?|mdx?|astro|html?|vue|svelte)$/.test(e.name) && re.test(path.relative(site, p))) out.push(p);
      }
    })(site, 0);
    return out;
  };

  const pages = [
    { id: 'privacy-deletion', name: 'privacy policy', re: /privacy/i, urls: urls.privacy, part: 'the privacy paragraph' },
    { id: 'support-deletion', name: 'support page', re: /support|faq/i, urls: urls.support, part: 'the support answer' },
  ];
  const fixFor = p => `Guideline 5.1.1(v): say where in the app to delete the account, and what gets deleted. Copy ${p.part} from "Deleting the account: the wording" in ${WORDING}. Use the same words in the app's Settings and on the other page.`;
  // Fetched in parallel, reported in a fixed order.
  const row = (...a) => a;
  const rows = await Promise.all(pages.map(async p => {
    const found = sites.flatMap(s => pageFiles(s, p.re));
    if (found.length) {
      const where = first(found.map(f => path.relative(DIR, f)), 2);
      const ok = mentions(found.map(f => toText(fs.readFileSync(f, 'utf8'))).join(' '));
      return row(p.id, ok ? 'OK' : 'FIX', ok ? `The ${p.name} mentions deleting the account (${where})` : `The ${p.name} does not mention deleting the account (${where})`, ok ? undefined : fixFor(p));
    }
    const url = [...new Set(p.urls)][0];
    if (!url) return row(p.id, 'CHECK', `Account deletion is in the app, but no ${p.name} was found in the repo or the config to check.`,
      `Check by hand that the ${p.name} says how to delete the account (${WORDING}, "Deleting the account: the wording"). To check it here, set app.${p.id.split('-')[0]}Url in .onebox.json.`);
    if (OFFLINE) return row(p.id, 'CHECK', `The ${p.name} (${url}) was not fetched (--offline). Check it mentions deleting the account.`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000), redirect: 'follow', headers: { 'user-agent': 'onebox-app-store-ready' } });
      if (!res.ok) return row(p.id, 'CHECK', `The ${p.name} ${url} returned HTTP ${res.status}. App Review needs it to load without a login.`);
      const text = toText(await res.text());
      if (mentions(text)) return row(p.id, 'OK', `The ${p.name} mentions deleting the account (${url})`);
      if (text.length < 300) return row(p.id, 'CHECK', `The ${p.name} ${url} has almost no text in its HTML. It may render in the browser only. Check it mentions deleting the account.`);
      return row(p.id, 'FIX', `The ${p.name} ${url} does not mention deleting the account.`, fixFor(p));
    } catch (e) {
      return row(p.id, 'CHECK', `Could not load the ${p.name} ${url} (${e.name === 'TimeoutError' ? 'timed out' : e.cause?.code || e.message}). Check it mentions deleting the account.`);
    }
  }));
  for (const r of rows) add(...r);
}

// ---- Payments -----------------------------------------------------------------------
const iap = has('react-native-purchases', 'react-native-iap', 'expo-iap', 'expo-in-app-purchases');
const extPay = grep(/stripe|paypal|checkout\.session|buy\.stripe\.com|lemonsqueezy|paddle/i);
if (extPay.length && !iap) add('iap', 'FIX', `External payment code in the app: ${first(extPay)}`, 'Guideline 3.1.1: digital content and features must use in-app purchase. Physical goods and real-world services must NOT use IAP (3.1.5, 3.1.3(d)). Know which one you sell.');
if (iap) {
  const restore = anySrc(/restorePurchases|restoreTransactions|getAvailablePurchases|Restore purchases?/i);
  add('restore', restore ? 'OK' : 'BLOCKED', restore ? 'Restore purchases found' : 'In-app purchase SDK but no restore purchases.', restore ? undefined : 'Add a visible "Restore purchases" button on the paywall and in settings (3.1.1).');
  const terms = anySrc(/terms of (use|service)|EULA|termsUrl|terms_url/i), privacy = anySrc(/privacy policy|privacyUrl|privacy_url/i);
  add('paywall-links', terms && privacy ? 'OK' : 'FIX', terms && privacy ? 'Terms and privacy links found' : `Paywall link missing: ${[!terms && 'Terms of Use (EULA)', !privacy && 'Privacy Policy'].filter(Boolean).join(', ')}`,
    terms && privacy ? undefined : 'Subscriptions need functional links to Terms of Use and the Privacy Policy in the app, plus price, period and what is included (3.1.2).');
  const hardPrice = grep(/['"`]\$\s?\d+[.,]\d\d/);
  if (hardPrice.length) add('paywall-prices', 'FIX', `Hard-coded prices: ${first(hardPrice)}`, 'Show the localized price string from the store (e.g. RevenueCat package.product.priceString). Prices differ per country.');
  if (deps['react-native-purchases']) {
    const key = [JSON.stringify(eas || {}), ...src.map(s => s.t)].join('\n');
    if (/['"]sk_[A-Za-z0-9]{10,}/.test(key)) add('revenuecat-key', 'BLOCKED', 'A RevenueCat SECRET key (sk_…) is in the app or eas.json.', 'Remove it and rotate it. The app uses the public appl_ key only.');
    if (!anySrc(/Purchases\.logIn|logIn\(/)) add('revenuecat-login', 'FIX', 'Purchases.logIn() not found.', 'Log in to RevenueCat with your own user ID after sign-in, or purchases sit on an anonymous ID your server cannot match.');
  }
  const bypass = grep(/GRANT_ALL_PREMIUM|grantAllPremium|isReviewer|REVIEW_MODE|bypassPaywall/i);
  if (bypass.length) add('review-bypass', 'FIX', `A premium bypass flag: ${first(bypass)}`, 'App Review buys in the sandbox like everyone else. A global bypass tends to leak to real users. Give the review account access on the server instead, or let them buy in sandbox.');
}

// ---- Backend URLs and networking ------------------------------------------------------------
const localRe = /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[\w-]+\.local\b)|\.ngrok(-free)?\.(io|app|dev)/;
const lineOf = ref => { const [f, n] = ref.split(':'); return src.find(s => s.f === f)?.t.split('\n')[+n - 1] || ''; };
const devOnly = ref => /__DEV__|isDev|isDevelopment|NODE_ENV|development/.test(lineOf(ref));
const localAll = grep(localRe), local = localAll.filter(r => !devOnly(r)), localDev = localAll.filter(devOnly);
if (localDev.length) add('backend-url-dev', 'CHECK', `Local URLs behind a dev check: ${first(localDev)}`, 'Fine if they can only run in development. Make sure a release build with no API URL shows an error instead of calling localhost.');
const cleartext = grep(/['"`]http:\/\/(?!localhost|127\.0\.0\.1|www\.w3\.org|schemas\.)/).filter(r => !devOnly(r) && !localRe.test(lineOf(r)));
if (local.length) add('backend-url', 'BLOCKED', `Local/LAN addresses in app code: ${first(local)}`, 'A reviewer\'s phone cannot reach your laptop or LAN. Read the API URL from EXPO_PUBLIC_API_URL per EAS profile, and make sure the production value is a public https URL.');
if (cleartext.length) add('https', 'FIX', `Plain http:// URLs: ${first(cleartext)}`, 'Use https. iOS blocks cleartext by default (App Transport Security), so these requests fail on a phone.');
// App Transport Security: what weakens it for public hosts. Local addresses are for development.
const localHost = d => /^(localhost|127\.0\.0\.1|\[?::1\]?|[\w-]+\.local|10\.\d|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(d);
const atsIssues = ats => {
  if (!ats || typeof ats !== 'object') return [];
  const out = [];
  if (ats.NSAllowsArbitraryLoads === true) out.push('NSAllowsArbitraryLoads: true');
  for (const k of ['NSAllowsArbitraryLoadsInWebContent', 'NSAllowsArbitraryLoadsForMedia']) if (ats[k] === true) out.push(`${k}: true`);
  for (const [d, o] of Object.entries(ats.NSExceptionDomains || {}))
    if (!localHost(d) && (o?.NSExceptionAllowsInsecureHTTPLoads === true || o?.NSTemporaryExceptionAllowsInsecureHTTPLoads === true))
      out.push(`insecure HTTP allowed for ${d}`);
  return out;
};
const rawAtsIssues = atsIssues((readJson('app.json')?.expo || {}).ios?.infoPlist?.NSAppTransportSecurity);
const resolvedAtsIssues = atsIssues(plist.NSAppTransportSecurity).filter(i => !rawAtsIssues.includes(i));
if (rawAtsIssues.length) add('ats', 'FIX', `app.json weakens App Transport Security: ${rawAtsIssues.join('; ')}.`, 'Remove it. Serve every host over https. Review asks you to justify these exceptions, and they apply to release builds too. A LAN address in development does not need them.');
if (resolvedAtsIssues.length) add('ats', 'CHECK', `The resolved Info.plist weakens App Transport Security: ${resolvedAtsIssues.join('; ')} (from app.config, a plugin or the native template).`, 'Find where it comes from and remove it. Check ios/<App>/Info.plist of a release build: only local networking should be allowed.');
if (!rawAtsIssues.length && !resolvedAtsIssues.length) add('ats', 'OK', 'App Transport Security is not weakened for public hosts');
const envVars = [...new Set(src.flatMap(s => [...s.t.matchAll(/process\.env\.(EXPO_PUBLIC_[A-Z0-9_]+)/g)].map(m => m[1])))];
if (envVars.length && eas?.build) {
  // EAS uploads only files git does not ignore, so a git-ignored .env never reaches a build.
  const envReachesBuilds = exists('.env') && !gitIgnored('.env');
  const onlyLocal = envVars.filter(v => !envReachesBuilds || !fs.readFileSync(path.join(DIR, '.env'), 'utf8').includes(v + '='))
    .filter(v => !Object.values(eas.build).some(p => p?.env && v in p.env));
  if (onlyLocal.length) add('env-in-builds', 'CHECK', `${onlyLocal.join(', ')} are not in eas.json env or a committed .env.`, 'They are inlined at build time. If they live only in .env.local or on your machine, other builds get "". Check EAS: eas env:list --environment production. Also make the app show a clear error when the API URL is empty.');
  else add('env-in-builds', 'OK', `${envVars.length} EXPO_PUBLIC_ variables defined for builds`);
}
if (!results.some(r => ['backend-url', 'https'].includes(r.id))) add('backend-url', 'OK', 'No localhost, LAN or http:// URLs in app code');

// ---- Secrets, tokens and debug switches in the app ----------------------------------------------
// Everything in EXPO_PUBLIC_* and in the app config's `extra` ships inside the app, readable by anyone.
const SECRET_VALUES = [
  [/\bsk_(live|test)_[A-Za-z0-9]{10,}/, 'a secret key (sk_live_/sk_test_)'],
  [/\bsk_[A-Za-z0-9]{20,}/, 'a secret key (sk_...)'],
  [/\bsk-(proj-|ant-)?[A-Za-z0-9_-]{20,}/, 'an AI provider key (sk-...)'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\b(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/, 'a GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
];
const secretKind = v => SECRET_VALUES.find(([re]) => re.test(String(v)))?.[1];
const SECRET_NAME = /SECRET|PRIVATE_?KEY|PASSWORD|PASSWD|SERVICE_ROLE|ADMIN_(KEY|TOKEN)|(^|_)SK(_|$)|(OPENAI|ANTHROPIC|CLAUDE|GEMINI|GOOGLE_AI|MISTRAL|GROQ|DEEPSEEK|REPLICATE|ELEVENLABS|FAL|KIE|STRIPE)\w*_(API_)?(KEY|TOKEN)/i;
const GOOGLE_KEY = /\bAIza[0-9A-Za-z_-]{35}\b/;
// name/value pairs that end up in the app: eas.json env, EXPO_PUBLIC_ lines of .env files, and `extra`.
const pairs = [];
for (const [prof, p] of Object.entries(eas?.build || {})) for (const [k, v] of Object.entries(p?.env || {})) pairs.push({ where: `eas.json build.${prof}.env.${k}`, k, v, pub: k.startsWith('EXPO_PUBLIC_') });
for (const f of fs.readdirSync(DIR).filter(f => /^\.env(\.|$)/.test(f) && !/\.(example|sample|template)$/.test(f))) {
  try {
    for (const m of fs.readFileSync(path.join(DIR, f), 'utf8').matchAll(/^\s*(?:export\s+)?(EXPO_PUBLIC_[A-Z0-9_]+)\s*=\s*(.*)$/gm))
      pairs.push({ where: `${f}: ${m[1]}`, k: m[1], v: m[2].replace(/^['"]|['"]$/g, ''), pub: true });
  } catch {}
}
(function flat(o, pre) {
  for (const [k, v] of Object.entries(o || {})) {
    if (!pre && ['eas', 'router'].includes(k)) continue;
    if (v && typeof v === 'object') flat(v, `${pre}${k}.`);
    else if (typeof v === 'string') pairs.push({ where: `app config extra.${pre}${k}`, k, v, pub: true });
  }
})(expo.extra, '');
for (const v of envVars) if (!pairs.some(p => p.k === v)) pairs.push({ where: `process.env.${v} in the source`, k: v, v: '', pub: true });

const rcReported = results.some(r => r.id === 'revenuecat-key');
const leakedVals = pairs.map(p => ({ ...p, kind: secretKind(p.v) })).filter(p => p.kind && !(rcReported && /sk_/.test(p.kind)));
const leakedSrc = grep(new RegExp(SECRET_VALUES.map(([re]) => re.source).join('|')));
const leakedSrcNew = rcReported ? leakedSrc.filter(r => !/['"]sk_/.test(lineOf(r))) : leakedSrc;
if (leakedVals.length || leakedSrcNew.length)
  add('public-secrets', 'BLOCKED', `A secret value in the app or its build config: ${first([...leakedVals.map(p => `${p.where} (${p.kind})`), ...leakedSrcNew])}`,
    'Anyone can read it from the app. Move the call that needs it to your backend, remove the value, and rotate it: builds already out there keep the old one.');
const badNames = pairs.filter(p => p.pub && SECRET_NAME.test(p.k) && !leakedVals.some(l => l.where === p.where));
if (badNames.length)
  add('public-secrets', 'FIX', `Secret-looking names in values the app ships: ${first(badNames.map(p => p.where))}`,
    'EXPO_PUBLIC_ variables and app config `extra` are public. A provider key or a password there is readable by anyone. Call the provider from your backend. Only public keys (the RevenueCat appl_ key, the API URL) belong in the app.');
const gkeys = [...pairs.filter(p => GOOGLE_KEY.test(String(p.v))).map(p => p.where), ...grep(GOOGLE_KEY)];
if (gkeys.length) add('google-key', 'CHECK', `A Google API key ships in the app: ${first(gkeys)}`,
  'Firebase and Maps keys are meant to be public, but restrict each one to your bundle ID and to the APIs it needs, in the Google Cloud console. A Gemini key must never be in the app.');
if (!results.some(r => r.id === 'public-secrets')) add('public-secrets', 'OK', `No secret-looking values or names in ${pairs.length} shipped settings or in the source`);

// Session tokens belong in the Keychain (expo-secure-store), not in AsyncStorage.
const TOKENISH = /token|jwt|refresh|session|auth|password|secret|credential/i;
const asyncTok = grep(/AsyncStorage\s*\.\s*(setItem|multiSet|mergeItem)\s*\(/).filter(r => TOKENISH.test(lineOf(r)) && !/push|notification|fcm|apns/i.test(lineOf(r)));   // a push token is not a secret
const persisted = src.filter(s => /createJSONStorage\(\s*\(\)\s*=>\s*AsyncStorage|storage:\s*AsyncStorage\b/.test(s.t) && /accessToken|refreshToken|idToken|authToken|\bjwt\b/i.test(s.t)).map(s => s.f);
const secureStore = has('expo-secure-store', 'react-native-keychain') || anySrc(/SecureStore\.|from ['"]react-native-keychain['"]/);
if (asyncTok.length) add('token-storage', 'FIX', `Tokens written to AsyncStorage: ${first(asyncTok)}`, 'AsyncStorage is a plain file that goes into device backups. Store access and refresh tokens with expo-secure-store (the Keychain). Keep AsyncStorage for settings that are not secret.');
else if (persisted.length) add('token-storage', 'CHECK', `A store that holds tokens is persisted to AsyncStorage: ${first(persisted)}`, 'Check whether the persisted part includes the tokens. If it does, persist the tokens with expo-secure-store instead.');
else if (accountLike && !secureStore) add('token-storage', 'CHECK', 'The app has accounts but no expo-secure-store or Keychain use was found.', 'Find where the session token is stored. It belongs in expo-secure-store, not in AsyncStorage or a plain file.');
else if (accountLike) add('token-storage', 'OK', 'Keychain storage (expo-secure-store) in use; no tokens written to AsyncStorage');

// Debug switches in the production profile.
const prodEnv = prodProfile?.env || {};
const devFlags = Object.entries(prodEnv).filter(([k, v]) => /DEBUG|DEV_?(MODE|MENU|TOOLS)|MOCK|FAKE|BYPASS|SKIP_(AUTH|LOGIN|PAYWALL)|TEST_(USER|LOGIN|ACCOUNT)|ENABLE_DEV|STORYBOOK/i.test(k) && /^(1|true|yes|on)$/i.test(String(v).trim())).map(([k]) => k);
if (prodProfile?.developmentClient) add('dev-flags', 'FIX', 'The production profile has developmentClient: true.', 'That builds a development client with the developer menu. Keep developmentClient on the development profile only.');
if (devFlags.length) add('dev-flags', 'FIX', `Debug switches turned on in the production profile: ${devFlags.join(', ')}`, 'Put debug features behind __DEV__, which is false in release builds, not behind an EXPO_PUBLIC_ flag.');
if (prodProfile && !results.some(r => r.id === 'dev-flags')) add('dev-flags', 'OK', 'No debug switches on in the production profile');

// ---- Content and platform -------------------------------------------------------------
const placeholder = grep(/lorem ipsum|coming soon|placeholder text|TODO: ?copy|\bdummy data\b|test@test|foo@bar/i);
add('placeholder', placeholder.length ? 'FIX' : 'OK', placeholder.length ? `Placeholder content: ${first(placeholder)}` : 'No obvious placeholder text', placeholder.length ? 'Guideline 2.1: remove placeholder text, empty screens and "coming soon" features before review.' : undefined);
const android = grep(/Google Play|Play Store|Android app/i);
if (android.length) add('other-platforms', 'FIX', `Mentions of other platforms in app code: ${first(android)}`, 'Guideline 2.3.10: do not show other mobile platforms in the iOS app. Hide these strings on iOS.');
const aiDeps = ['openai', '@google/generative-ai', '@google/genai', '@anthropic-ai/sdk', 'ai', '@ai-sdk/openai'].filter(d => deps[d]);
const aiUse = aiDeps.length || anySrc(/openai|gemini|anthropic|\/chat\/completions|\bLLM\b/i);
if (aiUse) {
  const consent = anySrc(/ai.?consent|consent.*(ai|third)|share.*with.*ai/i);
  add('ai-consent', consent ? 'OK' : 'FIX', consent ? 'AI data-sharing consent found' : 'The app appears to send user content to a third-party AI, but no consent step was found.',
    consent ? undefined : 'Guideline 5.1.2(i): disclose that personal data goes to a third-party AI and get explicit permission before the first send. See references/checklist.md.');
}
if (ios.supportsTablet) add('ipad', 'CHECK', 'ios.supportsTablet is true: App Review tests on iPad and you need iPad screenshots.', 'Test every screen on an iPad simulator, or set supportsTablet false if the app is phone-only.');

// ---- eas.json ------------------------------------------------------------------------
if (!eas) add('eas-json', 'BLOCKED', 'No eas.json.', 'Run eas build:configure in the app folder.');
else {
  if (!prodProfile) add('eas-json', 'BLOCKED', 'eas.json has no production build profile.');
  else if (prodProfile.distribution === 'internal') add('eas-json', 'BLOCKED', 'The production profile uses internal (ad hoc) distribution; it cannot go to the App Store.', 'Remove "distribution": "internal" from build.production. Keep it on preview.');
  else add('eas-json', 'OK', `eas.json profiles: ${Object.keys(eas.build || {}).join(', ')}`);
  const sub = eas.submit?.production?.ios || {};
  if (!sub.ascAppId) add('eas-submit', 'FIX', 'submit.production.ios.ascAppId is not set.', 'Add the numeric App Store Connect app ID so eas submit runs without prompts (appstore-connect skill: asc.mjs apps).');
  const nk = ['ascApiKeyPath', 'ascApiKeyId', 'ascApiKeyIssuerId'].filter(k => sub[k]).length;
  if (nk && nk < 3) add('eas-submit-key', 'BLOCKED', 'submit.production.ios sets only some of ascApiKeyPath / ascApiKeyId / ascApiKeyIssuerId.', 'Set all three or none. With some set, eas submit refuses to run.');
  const profilesWithLocal = Object.entries(eas.build || {}).filter(([, p]) => /localhost|127\.0\.0\.1|http:\/\//.test(JSON.stringify(p?.env || {}))).map(([n]) => n);
  if (profilesWithLocal.includes('production')) add('eas-env', 'BLOCKED', 'The production profile env points at localhost or http://.');
}
// A stray app config above the app folder can make EAS turn capabilities off.
for (let d = path.dirname(DIR), i = 0; i < 3 && d !== path.dirname(d); d = path.dirname(d), i++) {
  for (const f of ['app.json', 'app.config.js', 'app.config.ts']) {
    const p = path.join(d, f);
    if (fs.existsSync(p) && !/throw/.test(fs.readFileSync(p, 'utf8'))) add('decoy-config', 'FIX', `${p} exists above the app folder.`, 'If eas runs from there it syncs that config to Apple and can disable Sign in with Apple or push. Replace it with an app.config.js that throws.');
  }
  if (fs.existsSync(path.join(d, '.git'))) break;
}

// ---- Toolchain (checked 2026-09-28 at developer.apple.com/news/upcoming-requirements) ----
try {
  const full = execFileSync('xcodebuild', ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).match(/Xcode (\d+)(?:\.(\d+))?/);
  const xv = full?.[1], xminor = +(full?.[2] ?? 0);
  // The Expo SDK decides the Xcode: guides/xcode.md, "Which Xcode for your Expo SDK".
  const sdk = +String(deps.expo ?? '').replace(/^[^0-9]*/, '').split('.')[0] || null;
  const configText = ['app.json', 'app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs'].filter(exists).map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
  const scene = /enableSceneSupport"?\s*:\s*true/.test(configText);
  const XGUIDE = 'https://onebox.lokkesveen.com/guides/xcode.md, "Which Xcode for your Expo SDK"';
  if (xv && +xv < 26) add('xcode', 'BLOCKED', `Xcode ${xv} on this Mac`, 'Since 2026-04-28 uploads must be built with Xcode 26+ and the iOS 26 SDK. Update Xcode (https://onebox.lokkesveen.com/guides/xcode.md), or build in the EAS cloud with a current image.');
  else if (xv && sdk >= 56 && +xv === 26 && xminor < 4) add('xcode', 'BLOCKED', `Expo SDK ${sdk} needs Xcode 26.4 or later; this Mac has ${xv}.${xminor}.`, XGUIDE);
  else if (xv && +xv >= 27 && sdk && sdk <= 56) add('xcode', 'BLOCKED', `Xcode ${xv} builds with the iOS 27 SDK, and Expo SDK ${sdk} has no scene support: the app would not launch on iOS 27.`, `Build with Xcode 26.4 or later, or upgrade the SDK. ${XGUIDE}`);
  else if (xv && +xv >= 27 && sdk === 57 && !scene) add('xcode', 'BLOCKED', `Xcode ${xv} builds with the iOS 27 SDK, and scene support is off: the app would not launch on iOS 27.`, `Turn it on: expo-build-properties ios.enableSceneSupport, with expo 57.0.23 or newer. ${XGUIDE}`);
  else if (xv) add('xcode', 'OK', `Xcode ${xv}.${xminor} on this Mac${sdk ? `, Expo SDK ${sdk}` : ''}`);
} catch { add('xcode', 'CHECK', 'No Xcode here. Uploads need Xcode 26+ / iOS 26 SDK (since 2026-04-28).', 'For cloud builds, use a current EAS build image.'); }
const dt = (expo.plugins || []).map(p => Array.isArray(p) && p[0] === 'expo-build-properties' ? p[1]?.ios?.deploymentTarget : null).find(Boolean);
if (dt && parseFloat(dt) < 13) add('deployment-target', 'BLOCKED', `iOS deployment target ${dt}; uploads must target iOS 13 or later (since 2026-09-09).`);

// ---- Things only a human or App Store Connect can answer ------------------------------------
const manual = [
  ['offline-launch', 'Launch with airplane mode on, and with the server down. The app must not crash or hang on a blank screen (2.1).'],
  ['device-test', 'Test a release build on a real iPhone, not only the simulator (2.1).'],
  ['demo-account', 'App Review notes: a demo account with sample data, or a note that Sign in with Apple works with any Apple ID. Turn the backend on (2.1).'],
  ['min-functionality', 'The app does something useful beyond a website in a wrapper (4.2).'],
  ['privacy-policy', 'Privacy policy URL in App Store Connect AND a link inside the app (5.1.1(i)).'],
  ['support-url', 'Support URL in App Store Connect that loads and has a way to contact you.'],
  ['app-privacy', 'App Privacy answers in App Store Connect match what the code really collects and sends, including SDKs.'],
  ['age-rating', 'Age rating questionnaire answered (the new questions were due 2026-01-31).'],
  ['screenshots', 'At least one 6.9" (or 6.5") iPhone screenshot set; iPad set if supportsTablet (app-store-screenshots skill).'],
  ['dsa-trader', 'EU: trader status set in App Store Connect, or the app is not shown in the EU.'],
];
if (iap) manual.push(
  ['paid-apps-agreement', 'Paid Apps Agreement, tax and banking active in App Store Connect (Business). Without it products load empty.'],
  ['products-match', 'Subscription group and products exist in App Store Connect, and the product IDs match RevenueCat / the code.'],
  ['iap-with-version', 'The first subscription or IAP is attached to the app version you submit.'],
  ['sandbox-purchase', 'A sandbox purchase, a restore on a fresh install, and a cancellation, tested on a device.']);
for (const [id, msg] of manual) add(id, 'CHECK', msg);

// ---- Report ----------------------------------------------------------------------------
if (JSON_OUT) { console.log(JSON.stringify({ dir: DIR, configSource, results }, null, 2)); process.exit(0); }
const order = { BLOCKED: 0, FIX: 1, CHECK: 2, OK: 3 };
results.sort((a, b) => order[a.status] - order[b.status]);
console.log(`App Store readiness: ${DIR}\nConfig from: ${configSource}\n`);
for (const r of results) {
  console.log(`${r.status.padEnd(7)} ${r.id.padEnd(20)} ${r.msg}`);
  if (r.fix && r.status !== 'OK') console.log(`${' '.repeat(29)}-> ${r.fix}`);
}
const n = s => results.filter(r => r.status === s).length;
console.log(`\n${n('BLOCKED')} blocked, ${n('FIX')} to fix, ${n('CHECK')} to check by hand, ${n('OK')} OK.`);
process.exit(n('BLOCKED') ? 1 : 0);
