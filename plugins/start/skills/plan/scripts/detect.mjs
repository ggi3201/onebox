#!/usr/bin/env node
// Look at an app repo and print what it already has, as JSON.
//
// Read-only. It never runs the app's code: app.config.js is read as text,
// because some repos keep a root app.config.js that throws on purpose, to stop
// `eas` from running one folder too high.
//
// It runs one set of commands: the checks of the tools item (`node -v`,
// `pnpm -v` and the like), the same ones `plan.mjs ready` runs (needs.mjs).
// They are read-only and non-interactive, and each has a timeout. A check that
// cannot run never ticks the item. ONEBOX_DETECT_NO_RUN=1 skips them; the
// repo's own scripts set it, because they run with a fake HOME.
//
// Usage: node detect.mjs [repo-dir]    (default: the current folder)
// Node 18+, no dependencies.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadNeeds, loadConfig, checkNeeds } from "./needs.mjs";

const root = path.resolve(process.argv[2] ?? ".");
const SKIP = new Set([
  "node_modules", ".git", "ios", "android", "build", "dist", "bin", "obj",
  ".expo", ".next", ".turbo", ".worktrees", "Pods", "coverage", "vendor",
  "DerivedData", "artifacts", ".venv", "venv", "__pycache__",
]);

// ---------- small helpers ----------

const rel = (p) => path.relative(root, p) || ".";
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const readText = (p, max = 512 * 1024) => {
  try { const s = fs.statSync(p); if (!s.isFile() || s.size > max) return null; return fs.readFileSync(p, "utf8"); }
  catch { return null; }
};
const readJson = (p) => {
  const t = readText(p);
  if (t == null) return null;
  // eas.json and app.json are plain JSON; tolerate // comments in eas.json.
  try { return JSON.parse(t); } catch {}
  try { return JSON.parse(t.replace(/^\s*\/\/.*$/gm, "")); } catch { return null; }
};
const subdirs = (d) => {
  try {
    return fs.readdirSync(d, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP.has(e.name))
      .map((e) => path.join(d, e.name))
      .sort();
  } catch { return []; }
};
function walk(dir, { depth = 5, test, limit = 4000 }, out = [], state = { n: 0 }) {
  if (depth < 0 || state.n > limit) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".env.example") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, { depth: depth - 1, test, limit }, out, state); }
    else if (e.isFile() && test(e.name)) { state.n++; out.push(p); }
  }
  return out;
}
const deps = (pkg) => ({ ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) });
const uniq = (a) => [...new Set(a)];

// ---------- which folders to look at ----------

// The root, each direct subfolder, and apps/* and packages/* for monorepos.
const dirs = uniq([
  root,
  ...subdirs(root),
  ...subdirs(path.join(root, "apps")),
  ...subdirs(path.join(root, "packages")),
]);
const pkgs = dirs
  .map((d) => ({ dir: d, pkg: readJson(path.join(d, "package.json")) }))
  .filter((x) => x.pkg);

const notes = [];

// ---------- Expo app ----------

const APP_CONFIGS = ["app.config.ts", "app.config.js", "app.config.mjs", "app.config.cjs", "app.json"];

function appConfigFiles(d) { return APP_CONFIGS.filter((f) => exists(path.join(d, f))); }

const expoCandidates = pkgs.filter(({ pkg }) => deps(pkg).expo);
for (const d of dirs) {
  const files = appConfigFiles(d);
  if (files.length && !expoCandidates.some((c) => c.dir === d)) {
    notes.push(`${rel(d)}: has ${files.join(", ")} but no expo dependency next to it, so it is not the app.`);
  }
}
// Prefer a candidate that also has an app config.
const expoPick = expoCandidates.find((c) => appConfigFiles(c.dir).length) ?? expoCandidates[0];
if (expoCandidates.length > 1) {
  notes.push(`More than one Expo package: ${expoCandidates.map((c) => rel(c.dir)).join(", ")}. Used ${rel(expoPick.dir)}.`);
}

let expo = { found: false };
if (expoPick) {
  const d = expoPick.dir;
  const dp = deps(expoPick.pkg);
  const files = appConfigFiles(d);
  const appJson = files.includes("app.json") ? readJson(path.join(d, "app.json")) : null;
  const cfg = appJson?.expo ?? appJson ?? {};
  const dynText = files.filter((f) => f !== "app.json").map((f) => readText(path.join(d, f)) ?? "").join("\n");

  let bundleId = false;
  if (cfg.ios?.bundleIdentifier) bundleId = true;
  else if (/bundleIdentifier\s*:\s*['"`][^'"`]+['"`]/.test(dynText)) bundleId = true;
  else if (/bundleIdentifier\s*:/.test(dynText)) bundleId = "dynamic";

  const plugins = JSON.stringify(cfg.plugins ?? []) + dynText;
  // Both forms turn on the capability: usesAppleSignIn, or the entitlement itself.
  const usesAppleSignIn = cfg.ios?.usesAppleSignIn === true || /usesAppleSignIn\s*:\s*true/.test(dynText)
    || !!cfg.ios?.entitlements?.["com.apple.developer.applesignin"] || /com\.apple\.developer\.applesignin/.test(dynText);
  const easProjectId = !!cfg.extra?.eas?.projectId || /projectId\s*:/.test(dynText);

  const easFile = [path.join(d, "eas.json"), path.join(root, "eas.json")].find(exists);
  const eas = readJson(easFile ?? "") ?? null;
  const build = eas?.build ?? {};
  const profiles = Object.keys(build).sort();
  const apiUrlIn = profiles.filter((p) => Object.keys(build[p]?.env ?? {}).some((k) => /URL|API/i.test(k)));
  const devClientProfile = profiles.some((p) => build[p]?.developmentClient === true);
  const submits = Object.values(eas?.submit ?? {});
  const ascAppId = submits.some((s) => s?.ios?.ascAppId);
  // The team id can sit in the app config or in eas.json's submit profile.
  const appleTeamId = cfg.ios?.appleTeamId || /appleTeamId\s*:\s*['"`]/.test(dynText) ? "app config"
    : submits.some((s) => s?.ios?.appleTeamId) ? "eas.json" : false;

  // EAS Update: the package, the update URL, and a channel per build profile.
  const updates = {
    package: !!dp["expo-updates"],
    url: !!cfg.updates?.url || /updates\s*:\s*\{[^}]*\burl\s*:/.test(dynText),
    channels: profiles.filter((p) => build[p]?.channel),
  };

  expo = {
    found: true,
    dir: rel(d),
    config: files,
    bundleId,
    appleTeamId,
    easProjectId,
    devClient: !!dp["expo-dev-client"] || devClientProfile,
    expoGo: !dp["expo-dev-client"] && !devClientProfile,
    nativeIos: isDir(path.join(d, "ios")),
    eas: easFile ? { file: rel(easFile), profiles, apiUrlIn, ascAppId } : null,
    appleSignIn: { package: !!dp["expo-apple-authentication"], usesAppleSignIn, plugin: /expo-apple-authentication/.test(plugins) },
    revenuecat: !!dp["react-native-purchases"],
    revenuecatUi: !!dp["react-native-purchases-ui"],
    secureStore: !!dp["expo-secure-store"],
    updates,
    notifications: !!dp["expo-notifications"],
  };
}

// ---------- backend ----------

const backends = [];
const csprojs = walk(root, { depth: 5, test: (n) => n.endsWith(".csproj") });
const csText = new Map(csprojs.map((p) => [p, readText(p) ?? ""]));
for (const [p, t] of csText) {
  const web = /Sdk\s*=\s*"Microsoft\.NET\.Sdk\.Web"/.test(t);
  const test = /Microsoft\.NET\.Test\.Sdk|xunit|NUnit|MSTest/i.test(t);
  if (web && !test) backends.push({ kind: "aspnet", dir: rel(path.dirname(p)), file: rel(p) });
}
const otherCs = csprojs.filter((p) => !backends.some((b) => b.file === rel(p)));
if (otherCs.length) notes.push(`Other .NET projects (not a web API, or tests): ${otherCs.map(rel).join(", ")}.`);

const NODE_SERVERS = ["express", "fastify", "hono", "koa", "@nestjs/core", "@hapi/hapi"];
for (const { dir, pkg } of pkgs) {
  if (expoPick && dir === expoPick.dir) continue;
  const hit = NODE_SERVERS.filter((n) => deps(pkg)[n]);
  if (hit.length) backends.push({ kind: "node", framework: hit.join(", "), dir: rel(dir) });
}

// ---------- hosted backends, AI SDKs ----------

const allNpm = new Map(); // package name -> dirs
for (const { dir, pkg } of pkgs) for (const n of Object.keys(deps(pkg))) {
  if (!allNpm.has(n)) allNpm.set(n, []);
  allNpm.get(n).push(rel(dir));
}
const npmHas = (test) => [...allNpm.keys()].filter(test).sort().map((n) => `${n} (${allNpm.get(n).join(", ")})`);
const nugetHas = (re) => {
  const out = [];
  for (const [p, t] of csText) for (const m of t.matchAll(/PackageReference\s+Include\s*=\s*"([^"]+)"/g)) {
    if (re.test(m[1])) out.push(`${m[1]} (${rel(path.dirname(p))})`);
  }
  return uniq(out).sort();
};

const hosted = {
  supabase: npmHas((n) => n.startsWith("@supabase/")).concat(nugetHas(/^Supabase/)),
  firebase: npmHas((n) => n === "firebase" || n.startsWith("@react-native-firebase/")).concat(nugetHas(/^FirebaseAdmin/)),
  convex: npmHas((n) => n === "convex" || n.startsWith("@convex-dev/")),
};

const AI_NPM = (n) => n === "@anthropic-ai/sdk" || n === "openai" || n === "ai" || n.startsWith("@ai-sdk/")
  || n.startsWith("@openrouter/") || n === "@google/genai" || n === "@google/generative-ai";
const ai = {
  packages: npmHas(AI_NPM).concat(nugetHas(/^(Microsoft\.Extensions\.AI|Anthropic|OpenAI|Azure\.AI\.OpenAI|Google\.GenAI)/)),
  endpoints: {}, // AI API host -> first file that names it
};

// Grep source for a few strings. Backend folders and the app folder only.
const grepDirs = uniq([...backends.map((b) => path.join(root, b.dir)), ...(expoPick ? [expoPick.dir] : [])]);
const SRC = /\.(cs|ts|tsx|js|mjs|cjs|json)$|^\.env\.example$/;
const srcFiles = uniq(grepDirs.flatMap((d) => walk(d, { depth: 7, test: (n) => SRC.test(n) && !/lock/.test(n) })));
const isTestPath = (p) => rel(p).split(path.sep).some((seg, i, all) =>
  /(^|\.)tests?$/i.test(seg) || seg === "__tests__"
  || (i === all.length - 1 && (/[._-](test|spec)s?\.\w+$/i.test(seg) || /Tests?\.cs$/.test(seg))));
const AI_HOSTS = ["api.anthropic.com", "api.openai.com", "openrouter.ai", "generativelanguage.googleapis.com"];
let appleServer = null;
let pushServer = null; // a backend file that sends pushes: Expo's push API, or APNs directly
// Account deletion with Apple token revocation (sign-in-with-apple.md, step 6).
// Grep-level only, in backend files that are not tests:
// - deletion: a DELETE route (MapDelete, [HttpDelete], @Delete, .delete("...")
//   or method: "DELETE") in a file that has a route string ending in
//   /account, /users, /me (or with more after it, like "/api/account/{id}"),
//   or whose file name has "account" or "user" in it;
// - revocation: Apple's revoke URL, appleid.apple.com/auth/revoke, or
//   "auth/revoke" in a file that also names appleid.apple.com.
let accountDelete = null;
let appleRevoke = null;
const DELETE_ROUTE = /\bMapDelete\s*\(|\[HttpDelete\b|@Delete\s*\(|\.delete\s*\(\s*["'`]|method\s*:\s*["'`]DELETE["'`]/i;
const ACCOUNT_ROUTE = /["'`](?:[^"'`\n]*\/)(?:account|accounts|users?|me)(?:\/[^"'`\n]*)?["'`]/i;
for (const f of srcFiles) {
  if (isTestPath(f)) continue;
  const t = readText(f, 256 * 1024);
  if (!t) continue;
  const inBackend = backends.some((b) => f.startsWith(path.join(root, b.dir) + path.sep));
  if (!appleServer && inBackend && /appleid\.apple\.com/.test(t)) appleServer = rel(f);
  if (!pushServer && inBackend && /exp\.host|api(\.sandbox)?\.push\.apple\.com|expo-server-sdk/.test(t)) pushServer = rel(f);
  if (!accountDelete && inBackend && DELETE_ROUTE.test(t) && (ACCOUNT_ROUTE.test(t) || /account|user/i.test(path.basename(f)))) accountDelete = rel(f);
  if (!appleRevoke && inBackend && (/appleid\.apple\.com\/auth\/revoke/.test(t) || (/auth\/revoke/.test(t) && /appleid\.apple\.com/.test(t)))) appleRevoke = rel(f);
  for (const h of AI_HOSTS) if (!ai.endpoints[h] && t.includes(h)) ai.endpoints[h] = rel(f);
}

// ---------- docker compose, landing site ----------

const compose = fs.readdirSync(root).filter((f) => /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(f))
  .sort((a, b) => a.split(".").length - b.split(".").length || a.localeCompare(b));
const isStagingCompose = (f) => /[.-](stg|staging|qa)\./i.test(f);
// Compose files with a Traefik router that has a Host rule.
const traefikHosts = compose.filter((f) => /traefik\.http\.routers\.[\w-]+\.rule\s*[=:]\s*["']?Host\(/.test(readText(path.join(root, f)) ?? ""));

// ---------- GitHub workflows, helper scripts ----------

const wfDir = path.join(root, ".github", "workflows");
const workflows = (() => { try { return fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).sort(); } catch { return []; } })()
  .map((f) => ({ file: f, text: readText(path.join(wfDir, f)) ?? "" }));
const deployWorkflows = workflows.filter((w) => /deploy/i.test(w.file) || /docker[ -]compose\b[^\n]*\bup\b/.test(w.text)).map((w) => w.file);
// A workflow that runs the tests: a test or check script, or a test runner.
const RUNS_TESTS = /\b(npm|pnpm|yarn|bun|turbo)\b[^\n]*\b(test|check|vitest|jest)\b|\bdotnet\s+test\b|\bvitest\b|\bjest\b/;
const testWorkflows = workflows.filter((w) => RUNS_TESTS.test(w.text)).map((w) => w.file);

// Secrets injected by a tool at run time, in package scripts, scripts/ or workflows.
const SECRETS_RUN = /(^|[\s"'`;&|(])(doppler run|op run|op inject)\b/;
const secretsRunIn = [
  ...pkgs.filter(({ pkg }) => Object.values(pkg.scripts ?? {}).some((s) => SECRETS_RUN.test(String(s))))
    .map(({ dir }) => rel(path.join(dir, "package.json"))),
  ...walk(path.join(root, "scripts"), { depth: 2, test: () => true, limit: 200 })
    .filter((f) => SECRETS_RUN.test(readText(f, 128 * 1024) ?? "")).map(rel),
  ...workflows.filter((w) => SECRETS_RUN.test(w.text)).map((w) => `.github/workflows/${w.file}`),
];

const SITE_NAMES = /^(site|web|www|website|landing|landing-page|marketing|homepage)$/;
const sites = dirs.filter((d) => d !== root && d !== expoPick?.dir && (
  SITE_NAMES.test(path.basename(d)) && (exists(path.join(d, "package.json")) || exists(path.join(d, "index.html")))
  || ["astro.config.mjs", "astro.config.ts", "next.config.js", "next.config.mjs", "next.config.ts"].some((f) => exists(path.join(d, f)))
)).map(rel);

// ---------- onebox config (key names only, never values) ----------

function leafKeys(obj, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(obj ?? {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...leafKeys(v, p));
    else if (v !== "" && v != null) out.push(p);
  }
  return out.sort();
}
function configInfo(p) {
  if (!exists(p)) return { present: false };
  const j = readJson(p);
  if (!j) return { present: true, valid: false };
  return { present: true, valid: true, keysSet: leafKeys(j) };
}
const config = {
  user: configInfo(path.join(os.homedir(), ".config", "onebox", "config.json")),
  project: configInfo(path.join(root, ".onebox.json")),
};
const keySet = new Set([...(config.user.keysSet ?? []), ...(config.project.keysSet ?? [])]);
const hasKey = (k) => keySet.has(k);

// ---------- the Mac, the plan ----------

const xcode = exists("/Applications/Xcode.app");
const planPath = path.join(root, "PLAN.md");
const planText = readText(planPath);
const plan = planText == null ? { exists: false } : { exists: true, format: planText.startsWith("<!-- onebox-plan v1") ? "onebox" : "other" };

// ---------- test scripts ----------

const testScripts = uniq(pkgs.flatMap(({ dir, pkg }) => Object.keys(pkg.scripts ?? {})
  .filter((s) => /^(lint|typecheck|type-check|test|check)$/.test(s)).map((s) => `${s} (${rel(dir)})`))).sort();

// ---------- answers we can guess ----------

const answers = {};
const say = (id, value, confidence, why) => { answers[id] = { value, confidence, why }; };

if (!expo.found) say("stage", "idea", "likely", "no Expo app in this folder");
else if (expo.eas?.ascAppId) say("stage", "testflight", "likely",
  "eas.json has an App Store Connect app id. The repo cannot show if the app is on TestFlight only or on the App Store");
else say("stage", "expo", "high", `Expo app in ${expo.dir}`);

const hostedHit = [...hosted.supabase, ...hosted.firebase, ...hosted.convex];
if (backends.length) say("backend", "box", compose.length ? "high" : "likely",
  `${backends.map((b) => `${b.kind === "aspnet" ? "ASP.NET" : b.framework} API in ${b.dir}`).join("; ")}${compose.length ? `, ${compose[0]}` : ""}`);
else if (hostedHit.length) say("backend", "hosted", "high", hostedHit[0]);
else if (expo.found) say("backend", "none", "low", "no server code and no Supabase, Convex or Firebase SDK");

if (expo.appleSignIn?.package) say("login", "apple", "high", "expo-apple-authentication is in the app");
else if (expo.appleSignIn?.usesAppleSignIn) say("login", "apple", "high", "the app config turns on Sign in with Apple");
if (expo.revenuecat) say("paid", "subs", "high", "react-native-purchases is in the app");
if (sites.length) say("site", "yes", "likely", `site folder: ${sites.join(", ")}`);
const aiHits = [...ai.packages, ...Object.entries(ai.endpoints).map(([h, f]) => `${h} (${f})`)];
if (aiHits.length) say("ai", [], "low", `AI in the code: ${aiHits.join("; ")}. Which kind is not clear.`);

// ---------- what is already done ----------
// Keyed by "<kind>:<slug>", so every catalog alias of one guide or skill matches.
// "done" pre-ticks the item. "seen" only adds a note. "open" says what is
// still missing: it adds a note too, and it stops a "likely done" tick.

const done = {};
const seen = {};
const open = {};
const list = (a) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`);

if (xcode) done["guide:xcode"] = "Xcode is installed on this Mac";
if (hasKey("apple.teamId")) done["guide:apple-developer"] = "an Apple Team ID is set (apple.teamId in the onebox config)";
else if (expo.appleTeamId) done["guide:apple-developer"] = `an Apple Team ID is set (in ${expo.appleTeamId === "eas.json" ? expo.eas.file : "the app config"})`;

if (hasKey("secrets.tool")) done["guide:secrets"] = "secrets.tool is in the onebox config";
else if (secretsRunIn.length) done["guide:secrets"] = `secrets come from a tool at run time (doppler run or op run in ${secretsRunIn.join(", ")})`;

if (expo.found) {
  const missing = [];
  if (!expo.bundleId) missing.push("a bundle identifier");
  if (!expo.devClient) missing.push("a development build (the app uses Expo Go)");
  const want = ["development", "preview", "production"];
  const lack = want.filter((p) => !expo.eas?.profiles.includes(p));
  if (lack.length) missing.push(`eas.json profiles: ${lack.join(", ")}`);
  // Session tokens belong in the Keychain (expo-app.md, step 9). Only an app
  // with accounts or a server has them.
  const hasTokens = backends.length || hostedHit.length || expo.appleSignIn.package || expo.appleSignIn.usesAppleSignIn;
  if (hasTokens && !expo.secureStore) missing.push("expo-secure-store, to keep tokens in the Keychain");
  if (expo.appleSignIn.package && !expo.appleSignIn.usesAppleSignIn) {
    missing.push("usesAppleSignIn in the app config (without it, a build can turn Sign in with Apple off on the App ID)");
  }
  if (!missing.length) done["guide:expo-app"] = `Expo app in ${expo.dir} with a bundle id, a dev client and the three EAS profiles`;
  else open["guide:expo-app"] = `Expo app in ${expo.dir}; still missing ${missing.join("; ")}`;
  done["skill:start/new-app"] = `Expo app in ${expo.dir}`;
  if (expo.easProjectId && expo.eas) done["guide:expo-eas"] = "the EAS project is linked";
  if (expo.eas?.ascAppId) seen["guide:app-store-connect-setup"] = "eas.json has an ascAppId, so the app record exists";

  const u = expo.updates;
  if (u.package) {
    const lackU = [];
    if (!u.url) lackU.push("updates.url in the app config");
    if (!u.channels.length) lackU.push("a channel in each eas.json build profile");
    if (!lackU.length) done["skill:ship-ios/eas-update"] = `expo-updates is in the app, with an update URL and channels (${u.channels.join(", ")})`;
    else open["skill:ship-ios/eas-update"] = `expo-updates is in the app; still missing ${list(lackU)}`;
  }

  if (expo.notifications) {
    if (pushServer) done["guide:push-notifications"] = `expo-notifications is in the app, and the server sends pushes (${pushServer})`;
    else seen["guide:push-notifications"] = "expo-notifications is in the app; no server code that sends a push found";
  }
}

// Backend on the box: a Traefik router with a Host rule means the API has its
// hostname. With a deploy workflow too, the backend guide is done.
// The dev compose file (docker-compose.dev.yml) is not the production stack either.
const isDevCompose = (f) => /[.-]dev\./i.test(f);
const prodCompose = compose.filter((f) => !isStagingCompose(f) && !isDevCompose(f));
const stagingCompose = compose.filter(isStagingCompose);
const prodHosts = traefikHosts.filter((f) => !isStagingCompose(f));
if (prodHosts.length) done["skill:box/expose-service"] = `a Traefik router with a Host rule in ${prodHosts.join(", ")}`;
if (backends.length) {
  const where = `${backends.map((b) => b.dir).join(", ")}${compose.length ? ` and ${compose.join(", ")}` : ""}`;
  const lackB = [];
  if (!prodCompose.length) lackB.push("a docker-compose.yml");
  else if (!prodHosts.length) lackB.push("Traefik router labels in the compose file");
  if (!deployWorkflows.length) lackB.push("a deploy workflow in .github/workflows");
  // Name the production deploy, not the staging one, when both exist.
  const prodDeploys = workflows.filter((w) => deployWorkflows.includes(w.file) && !stagingCompose.some((f) => w.text.includes(f))).map((w) => w.file);
  const by = (prodDeploys.length ? prodDeploys : deployWorkflows).join(", ");
  if (!lackB.length) done["guide:backend"] = `${backends.map((b) => b.dir).join(", ")}, a Traefik router in ${prodHosts.join(", ")}, deployed by ${by}`;
  else seen["guide:backend"] = `${where}; still missing ${list(lackB)}`;
}
if (stagingCompose.length) {
  const deploys = workflows.filter((w) => stagingCompose.some((f) => w.text.includes(f))).map((w) => w.file);
  if (deploys.length) done["skill:box/staging-env"] = `${stagingCompose.join(", ")}, deployed by ${deploys.join(", ")}`;
  else seen["skill:box/staging-env"] = `${stagingCompose.join(", ")}; no workflow deploys it`;
}

// App Review wants account deletion in the app (guideline 5.1.1(v)), and Apple
// wants the tokens revoked then. So the token check alone is not a tick.
if (expo.appleSignIn?.package) {
  const lackA = [];
  if (!accountDelete) lackA.push("an account-deletion endpoint (a DELETE route for the account)");
  if (!appleRevoke) lackA.push("Apple token revocation on account deletion (a call to appleid.apple.com/auth/revoke)");
  if (!appleServer) seen["guide:sign-in-with-apple"] = "Sign in with Apple is wired in the app; no server-side token check found";
  else if (lackA.length) open["guide:sign-in-with-apple"] = `the server checks Apple's token (${appleServer}); for step 6, still missing ${list(lackA)}`;
  else done["guide:sign-in-with-apple"] = `Sign in with Apple is wired in the app; the server checks Apple's token (${appleServer}), deletes the account (${accountDelete}) and revokes Apple's tokens (${appleRevoke})`;
}
if (expo.revenuecat) done["guide:revenuecat"] = "react-native-purchases is in the app";
if (hasKey("apple.ascKeyId") && hasKey("apple.ascIssuerId")) {
  // The skills take the .p8 key from a path or from a secret reference; the path wins.
  if (hasKey("apple.ascKeyPath") || hasKey("apple.ascKeyRef")) done["guide:app-store-connect-api-key"] = "the App Store Connect key id, issuer id and key are in the onebox config";
  else open["guide:app-store-connect-api-key"] = "the key id and issuer id are in the onebox config; still missing apple.ascKeyPath or apple.ascKeyRef";
}
if (hasKey("box.domain")) done["guide:domain"] = "box.domain is in the onebox config";
// A box.ssh value means the user already has a box: do not ask them to rent one.
if (hasKey("box.ssh")) done["guide:vps"] = "you have a box: box.ssh is in the onebox config";
if (hasKey("box.ssh")) seen["skill:box/box-setup"] = "box.ssh is in the onebox config; run the check phase to confirm";
if (sites.length) seen["skill:box/new-landing-page"] = `site folder: ${sites.join(", ")}`;
if (aiHits.length || hasKey("llm.keyRef")) seen["guide:llm-api-key"] = "the code already calls an AI API";
if (hasKey("tracing.otlpEndpoint")) done["guide:langfuse"] = "tracing.otlpEndpoint is in the onebox config";

// The tools item: done when every check it needs passes on this Mac. These are
// the checks `ready` runs before the step. "unknown" (a check that could not
// run, or timed out) never ticks: it only adds a note.
let tools = null;
if (process.env.ONEBOX_DETECT_NO_RUN !== "1") {
  const catalog = readJson(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "references", "catalog.json"));
  const ids = (catalog?.items.find((it) => it.id === "tools")?.needs ?? []).filter((n) => typeof n === "string");
  if (ids.length) {
    const [r] = await checkNeeds([{ ids }], loadNeeds(), { repo: root, config: loadConfig(root), detect: {}, ticked: new Set() });
    const name = (n) => (/^(The|A|An)\b/.test(n.label) ? n.label[0].toLowerCase() + n.label.slice(1) : n.label);
    const ok = r.needs.filter((n) => ["ok", "skip"].includes(n.status));
    const unknown = r.needs.filter((n) => n.status === "unknown");
    const bad = r.needs.filter((n) => !ok.includes(n) && !unknown.includes(n));
    tools = Object.fromEntries(r.needs.map((n) => [n.id, n.status]));
    if (bad.length) open["guide:tools"] = `on this Mac, ${bad.map((n) => n.problem).join("; ")}`;
    else if (unknown.length) seen["guide:tools"] = `could not check ${list(uniq(unknown.map((n) => `${name(n)} (${n.why})`)))}`;
    else done["guide:tools"] = `the checks pass on this Mac: ${list(uniq(ok.map(name)))}`;
  }
}

// The test loop: one command that runs every check, and CI that runs the tests.
const scriptNames = new Set(testScripts.map((s) => s.split(" ")[0].replace("type-check", "typecheck")));
const oneCommand = scriptNames.has("check") || ["typecheck", "lint", "test"].every((n) => scriptNames.has(n));
if (oneCommand && testWorkflows.length) {
  done["guide:agent-test-loop"] = `scripts: ${testScripts.join(", ")}; ${list(testWorkflows)} ${testWorkflows.length > 1 ? "run" : "runs"} the tests`;
} else if (testScripts.length || testWorkflows.length) {
  const lackT = [];
  if (!oneCommand) lackT.push(`a check script (or typecheck, lint and test; no ${["typecheck", "lint", "test"].filter((n) => !scriptNames.has(n)).join(", ")})`);
  if (!testWorkflows.length) lackT.push("a workflow in .github/workflows that runs the tests");
  open["guide:agent-test-loop"] = `${testScripts.length ? `scripts: ${testScripts.join(", ")}` : `${list(testWorkflows)} runs tests`}; still missing ${list(lackT)}`;
}

// The /dev:test-loop skill, run to the end: its block in AGENTS.md or
// CLAUDE.md (the block names the preflight), a native build marked with
// `preflight.mjs --mark-built`, and at least one *.flow.md in the app.
// The marked build is a file in .expo/, which is not committed, so it shows
// the state of this Mac only.
if (expo.found) {
  const appDir = path.join(root, expo.dir);
  const agentsFile = ["AGENTS.md", "CLAUDE.md"].find((f) => /preflight\.mjs|dev:test-loop/.test(readText(path.join(root, f)) ?? ""));
  const marked = exists(path.join(appDir, ".expo", "dev-loop-fingerprint.json"));
  const flows = walk(appDir, { depth: 7, test: (n) => n.endsWith(".flow.md"), limit: 200 });
  const have = [], lackL = [];
  if (agentsFile) have.push(`the verify rules in ${agentsFile}`);
  else lackL.push("the verify rules in AGENTS.md or CLAUDE.md (the skill's AGENTS.snippet.md)");
  if (marked) have.push("a marked native build");
  else lackL.push(`a marked native build on this Mac (preflight.mjs --mark-built writes ${path.join(expo.dir, ".expo", "dev-loop-fingerprint.json")})`);
  if (flows.length) have.push(`${flows.length} *.flow.md ${flows.length > 1 ? "files" : "file"}`);
  else lackL.push("a *.flow.md file next to a feature");
  if (!lackL.length) done["skill:dev/test-loop"] = list(have);
  else if (have.length) seen["skill:dev/test-loop"] = `${list(have)}; still missing ${list(lackL)}`;
}

const cannotDetect = [
  "whether your Apple Developer membership is active",
  "whether the box passes box-setup's check phase",
  "whether the app record, agreements and products exist in App Store Connect",
  "whether a landing page or privacy policy is live",
  "whether a secret a config key points at really exists",
];

console.log(JSON.stringify({
  detect: "onebox v1",
  expo, backends, hosted, ai, appleServer, accountDelete, appleRevoke, pushServer, compose, traefikHosts, sites,
  workflows: { files: workflows.map((w) => w.file), deploy: deployWorkflows, tests: testWorkflows },
  secretsRunIn, config, xcode, tools, plan, testScripts,
  answers, done, seen, open, notes, cannotDetect,
}, null, 2));
