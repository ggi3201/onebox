#!/usr/bin/env node
// Look at an app repo and print what it already has, as JSON.
//
// Read-only. It never runs the app's code: app.config.js is read as text,
// because some repos keep a root app.config.js that throws on purpose, to stop
// `eas` from running one folder too high.
//
// Usage: node detect.mjs [repo-dir]    (default: the current folder)
// Node 18+, no dependencies.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
  const usesAppleSignIn = cfg.ios?.usesAppleSignIn === true || /usesAppleSignIn\s*:\s*true/.test(dynText);
  const easProjectId = !!cfg.extra?.eas?.projectId || /projectId\s*:/.test(dynText);
  const appleTeamId = !!cfg.ios?.appleTeamId || /appleTeamId\s*:\s*['"`]/.test(dynText);

  const easFile = [path.join(d, "eas.json"), path.join(root, "eas.json")].find(exists);
  const eas = readJson(easFile ?? "") ?? null;
  const build = eas?.build ?? {};
  const profiles = Object.keys(build).sort();
  const apiUrlIn = profiles.filter((p) => Object.keys(build[p]?.env ?? {}).some((k) => /URL|API/i.test(k)));
  const devClientProfile = profiles.some((p) => build[p]?.developmentClient === true);
  const ascAppId = Object.values(eas?.submit ?? {}).some((s) => s?.ios?.ascAppId);

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
for (const f of srcFiles) {
  if (isTestPath(f)) continue;
  const t = readText(f, 256 * 1024);
  if (!t) continue;
  const inBackend = backends.some((b) => f.startsWith(path.join(root, b.dir) + path.sep));
  if (!appleServer && inBackend && /appleid\.apple\.com/.test(t)) appleServer = rel(f);
  for (const h of AI_HOSTS) if (!ai.endpoints[h] && t.includes(h)) ai.endpoints[h] = rel(f);
}

// ---------- docker compose, landing site ----------

const compose = fs.readdirSync(root).filter((f) => /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(f))
  .sort((a, b) => a.split(".").length - b.split(".").length || a.localeCompare(b));

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
else if (expo.eas?.ascAppId) say("stage", "testflight", "likely", "eas.json has an App Store Connect app id");
else say("stage", "expo", "high", `Expo app in ${expo.dir}`);

const hostedHit = [...hosted.supabase, ...hosted.firebase];
if (backends.length) say("backend", "box", compose.length ? "high" : "likely",
  `${backends.map((b) => `${b.kind === "aspnet" ? "ASP.NET" : b.framework} API in ${b.dir}`).join("; ")}${compose.length ? `, ${compose[0]}` : ""}`);
else if (hostedHit.length) say("backend", "hosted", "high", hostedHit[0]);
else if (expo.found) say("backend", "none", "low", "no server code and no Supabase or Firebase SDK");

if (expo.appleSignIn?.package) say("login", "apple", "high", "expo-apple-authentication is in the app");
if (expo.revenuecat) say("paid", "subs", "high", "react-native-purchases is in the app");
if (sites.length) say("site", "yes", "likely", `site folder: ${sites.join(", ")}`);
const aiHits = [...ai.packages, ...Object.entries(ai.endpoints).map(([h, f]) => `${h} (${f})`)];
if (aiHits.length) say("ai", [], "low", `AI in the code: ${aiHits.join("; ")}. Which kind is not clear.`);

// ---------- what is already done ----------
// Keyed by "<kind>:<slug>", so every catalog alias of one guide or skill matches.
// "done" pre-ticks the item. "seen" only adds a note.

const done = {};
const seen = {};

if (xcode) done["guide:xcode"] = "Xcode is installed on this Mac";
if (hasKey("apple.teamId") || expo.appleTeamId) done["guide:apple-developer"] = "an Apple Team ID is set";

if (expo.found) {
  const missing = [];
  if (!expo.bundleId) missing.push("a bundle identifier");
  if (!expo.devClient) missing.push("a development build (the app uses Expo Go)");
  const want = ["development", "preview", "production"];
  const lack = want.filter((p) => !expo.eas?.profiles.includes(p));
  if (lack.length) missing.push(`eas.json profiles: ${lack.join(", ")}`);
  if (!missing.length) done["guide:expo-app"] = `Expo app in ${expo.dir} with a bundle id, a dev client and the three EAS profiles`;
  else seen["guide:expo-app"] = `Expo app in ${expo.dir}; still missing ${missing.join("; ")}`;
  if (expo.easProjectId && expo.eas) done["guide:expo-eas"] = "the EAS project is linked";
  if (expo.eas?.ascAppId) seen["guide:app-store-connect-setup"] = "eas.json has an ascAppId, so the app record exists";
}

if (expo.appleSignIn?.package) {
  if (appleServer) done["guide:sign-in-with-apple"] = `Sign in with Apple is wired in the app, and the server checks Apple's token (${appleServer})`;
  else seen["guide:sign-in-with-apple"] = "Sign in with Apple is wired in the app; no server-side token check found";
}
if (expo.revenuecat) done["guide:revenuecat"] = "react-native-purchases is in the app";
if (hasKey("apple.ascKeyId") && hasKey("apple.ascIssuerId")) done["guide:app-store-connect-api-key"] = "the App Store Connect key id and issuer id are in the onebox config";
if (hasKey("box.domain")) done["guide:domain"] = "box.domain is in the onebox config";
if (hasKey("box.ssh")) seen["skill:box/box-setup"] = "box.ssh is in the onebox config; run the check phase to confirm";
if (backends.length) seen["guide:backend"] = `${backends.map((b) => b.dir).join(", ")}${compose.length ? ` and ${compose.join(", ")}` : ""}`;
if (sites.length) seen["skill:box/new-landing-page"] = `site folder: ${sites.join(", ")}`;
if (aiHits.length || hasKey("llm.keyRef")) seen["guide:llm-api-key"] = "the code already calls an AI API";
if (hasKey("tracing.otlpEndpoint")) done["guide:langfuse"] = "tracing.otlpEndpoint is in the onebox config";
if (testScripts.length) seen["guide:agent-test-loop"] = `scripts: ${testScripts.join(", ")}`;

const cannotDetect = [
  "whether your Apple Developer membership is active",
  "whether the box passes box-setup's check phase",
  "whether the app record, agreements and products exist in App Store Connect",
  "whether a landing page or privacy policy is live",
  "whether a secret a config key points at really exists",
];

console.log(JSON.stringify({
  detect: "onebox v1",
  expo, backends, hosted, ai, appleServer, compose, sites,
  config, xcode, plan, testScripts,
  answers, done, seen, notes, cannotDetect,
}, null, 2));
