#!/usr/bin/env node
// Preflight for an Expo / React Native app in the iOS Simulator.
//
// Answers two questions before anyone debugs a "bug":
//   1. Is the simulator running THIS checkout's JavaScript?
//      (the right Metro server, on the right port, for this worktree)
//   2. Is the installed app binary still current, or did a native
//      dependency change so that only a rebuild (not a reload) can help?
//
//   node preflight.mjs [--dir <expo-app-dir>] [--bundle-id <id>]
//                      [--no-fingerprint] [--mark-built]
//
//   --mark-built   Record the native fingerprint after a native build
//                  (npx expo run:ios). Later runs compare against it.
//                  Stored in <app>/.expo/dev-loop-fingerprint.json.
//
// Exit codes: 0 all good, 1 a FAIL was found (fix it first), 2 bad usage.
// Read-only, except --mark-built, which writes one file under .expo/.
// Needs: macOS with Xcode (xcrun simctl), lsof, Node 18+.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const opt = { dir: "", bundleId: "", fingerprint: true, markBuilt: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--dir") opt.dir = args[++i] ?? "";
  else if (a === "--bundle-id") opt.bundleId = args[++i] ?? "";
  else if (a === "--no-fingerprint") opt.fingerprint = false;
  else if (a === "--mark-built") opt.markBuilt = true;
  else if (a === "-h" || a === "--help") {
    console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 19).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(0);
  } else {
    console.error(`Unknown option: ${a}`);
    process.exit(2);
  }
}

let fails = 0;
let warns = 0;
const ok = (m) => console.log(`  OK    ${m}`);
const info = (m) => console.log(`  INFO  ${m}`);
const warn = (m) => { warns++; console.log(`  WARN  ${m}`); };
const fail = (m) => { fails++; console.log(`  FAIL  ${m}`); };
const head = (m) => console.log(`\n${m}`);

function sh(cmd, argv, { quiet = true, timeout = 20000 } = {}) {
  try {
    return execFileSync(cmd, argv, { encoding: "utf8", stdio: ["ignore", "pipe", quiet ? "ignore" : "inherit"], timeout, maxBuffer: 512 * 1024 * 1024 }).trim();
  } catch {
    return null;
  }
}
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
const when = (ms) => (ms ? new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "unknown");

// ---------- 1. Which app, which checkout ----------
const APP_FILES = ["app.json", "app.config.ts", "app.config.js", "app.config.json"];
const isApp = (d) => APP_FILES.some((f) => fs.existsSync(path.join(d, f)));

function findAppDir() {
  if (opt.dir) return isApp(opt.dir) ? real(opt.dir) : null;
  for (let d = process.cwd(); ; d = path.dirname(d)) {
    if (isApp(d) && fs.existsSync(path.join(d, "package.json"))) return real(d);
    if (path.dirname(d) === d) break;
  }
  // A monorepo root: look one or two levels down.
  const found = [];
  for (const a of fs.readdirSync(process.cwd(), { withFileTypes: true })) {
    if (!a.isDirectory() || a.name.startsWith(".") || a.name === "node_modules") continue;
    const d1 = path.join(process.cwd(), a.name);
    if (isApp(d1)) found.push(d1);
    for (const b of fs.readdirSync(d1, { withFileTypes: true })) {
      if (b.isDirectory() && b.name !== "node_modules" && isApp(path.join(d1, b.name))) found.push(path.join(d1, b.name));
    }
  }
  if (found.length === 1) return real(found[0]);
  if (found.length > 1) {
    console.error(`More than one Expo app here. Pass --dir:\n  ${found.join("\n  ")}`);
    process.exit(2);
  }
  return null;
}

const appDir = findAppDir();
if (!appDir) {
  console.error("No Expo app found (no app.json or app.config.* here or above). Pass --dir <expo-app-dir>.");
  process.exit(2);
}

head("Checkout");
const top = sh("git", ["-C", appDir, "rev-parse", "--show-toplevel"]);
const branch = sh("git", ["-C", appDir, "branch", "--show-current"]) || "(detached HEAD)";
const gitDir = sh("git", ["-C", appDir, "rev-parse", "--absolute-git-dir"]);
const commonDir = sh("git", ["-C", appDir, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
info(`app dir   ${appDir}`);
if (top) {
  info(`branch    ${branch}${gitDir && commonDir && real(gitDir) !== real(commonDir) ? "  (linked worktree)" : ""}`);
  const dirty = (sh("git", ["-C", appDir, "status", "--porcelain"]) || "").split("\n").filter(Boolean).length;
  info(`changes   ${dirty} uncommitted file(s)`);
}

let bundleId = opt.bundleId;
let appJson = readJson(path.join(appDir, "app.json"));
if (!bundleId) bundleId = appJson?.expo?.ios?.bundleIdentifier ?? appJson?.ios?.bundleIdentifier ?? "";
if (!bundleId) {
  // app.config.* is code. Ask Expo to evaluate it.
  const out = sh("npx", ["--no-install", "expo", "config", "--type", "public", "--json"], { timeout: 60000 });
  try { bundleId = JSON.parse(out).ios?.bundleIdentifier ?? ""; } catch { /* keep empty */ }
}
bundleId ? info(`bundle id ${bundleId}`) : warn("No iOS bundle identifier found. Pass --bundle-id to check the installed app.");

// ---------- 2. Simulators ----------
head("Simulators");
const simJson = sh("xcrun", ["simctl", "list", "devices", "booted", "-j"]);
const booted = [];
try {
  for (const [runtime, list] of Object.entries(JSON.parse(simJson).devices)) {
    for (const d of list) if (d.state === "Booted") booted.push({ ...d, runtime: runtime.split(".").pop() });
  }
} catch { /* no simctl */ }
if (simJson === null) fail("xcrun simctl did not run. Install Xcode and run: sudo xcode-select -s /Applications/Xcode.app");
else if (booted.length === 0) warn("No simulator is booted. Boot one: xcrun simctl boot \"<device name>\" && open -a Simulator");
for (const d of booted) info(`booted    ${d.name} (${d.runtime})  ${d.udid}`);
if (booted.length > 1) warn(`${booted.length} simulators are booted. "booted" in simctl picks one of them at random. Pass the UDID, or shut the others down.`);

// ---------- 3. Metro servers ----------
head("Metro");
const lsof = sh("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"]) || "";
const ports = new Map(); // port -> pid
let pid = "", cmd = "";
for (const line of lsof.split("\n")) {
  if (line[0] === "p") pid = line.slice(1);
  else if (line[0] === "c") cmd = line.slice(1);
  else if (line[0] === "n" && /^(node|bun|deno)/.test(cmd)) {
    const port = Number(line.split(":").pop());
    if (port) ports.set(port, pid);
  }
}

async function probe(port) {
  const ctl = AbortSignal.timeout(1500);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/status`, { signal: ctl });
    const body = await r.text();
    if (!body.includes("packager-status:running")) return null;
    const root = r.headers.get("x-react-native-project-root");
    let targets = [];
    try {
      const j = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
      targets = await j.json();
    } catch { /* older Metro */ }
    return { port, root: root ? real(root) : null, targets };
  } catch {
    return null;
  }
}

const metros = (await Promise.all([...ports.keys()].map(probe))).filter(Boolean).sort((a, b) => a.port - b.port);
const devicesOf = (m) => [...new Set(m.targets.filter((t) => !bundleId || t.appId === bundleId).map((t) => t.deviceName).filter(Boolean))];
const mine = metros.filter((m) => m.root === appDir);
const others = metros.filter((m) => m.root !== appDir);

// CI mode: Expo turns off Metro's file watcher when CI is "1" or "true" in
// its environment. Metro then keeps serving the bundle from its start, and no
// edit reaches the simulator. `ps -E` prints the environment after the command.
function ciMode(p) {
  const cmd = sh("ps", ["-ww", "-o", "command=", "-p", p]);
  const all = sh("ps", ["-E", "-ww", "-o", "command=", "-p", p]);
  if (!cmd || !all || all.length <= cmd.length) return null; // environment not readable
  const ci = all.slice(cmd.length).match(/(?:^|\s)CI=(\S*)/)?.[1] ?? "";
  return { on: /^(1|true)$/i.test(ci), value: ci };
}

if (metros.length === 0) info("No Metro server is running.");
for (const m of metros) {
  const p = ports.get(m.port);
  const cmdline = sh("ps", ["-o", "command=", "-p", p]) || "";
  const who = m.root === appDir ? "this checkout" : m.root ? m.root : "unknown root";
  const conns = [...new Set(m.targets.map((t) => `${t.appId ?? "?"} on ${t.deviceName ?? "?"}`))];
  info(`:${m.port}  ${who}${conns.length ? `  <- ${conns.join(", ")}` : "  (no app connected)"}`);
  if (cmdline) info(`        ${cmdline.slice(0, 160)}`);
}

if (mine.length === 0) {
  const portArg = fs.existsSync(path.join(appDir, "scripts", "metro-port.sh")) ? `"$(sh scripts/metro-port.sh)"` : [8082, 8083, 8084, 8085].find((x) => !ports.has(x)) ?? 8090;
  fail(`No Metro server serves ${appDir}. The simulator cannot be running this checkout's code. Start one on this checkout's port from the app dir, for example: npx expo start --dev-client --port ${portArg}`);
} else {
  const connected = mine.flatMap(devicesOf);
  if (connected.length) ok(`This checkout's Metro (:${mine.map((m) => m.port).join(", :")}) has the app connected on: ${[...new Set(connected)].join(", ")}`);
  else warn(`This checkout's Metro (:${mine[0].port}) has no app connected${bundleId ? ` for ${bundleId}` : ""}. Open the app from this server (press i in the Metro terminal, or open the dev client and pick port ${mine[0].port}).`);
}
for (const m of mine) {
  const pid = ports.get(m.port);
  const c = ciMode(pid);
  const restart = `Stop it (pid ${pid}) and start it again without CI, from the app dir: env -u CI npx expo start --dev-client --port ${m.port}`;
  if (c?.on) fail(`This checkout's Metro (:${m.port}) runs in CI mode (CI=${c.value}). It does not watch files: no edit reaches the simulator, and Expo Router's typed routes are not generated again. ${restart}`);
  else if (c) ok(`This checkout's Metro (:${m.port}) watches files (not in CI mode)`);
  else info(`Could not read the environment of this checkout's Metro (pid ${pid}). If its log says "Metro is running in CI mode", it does not watch files. ${restart}`);
}
// Another app on this checkout's Metro: two apps use one port, and that app
// now shows this app's code.
for (const m of mine) {
  const foreign = [...new Set(m.targets.filter((t) => bundleId && t.appId && t.appId !== bundleId).map((t) => `${t.appId} on ${t.deviceName ?? "?"}`))];
  if (foreign.length) fail(`${foreign.join(", ")} is connected to this checkout's Metro (:${m.port}), but this app is ${bundleId}. Two apps use one Metro port, so that app shows this app's code. Give each app its own port: scripts/metro-port.sh in references/preflight.md.`);
}
for (const m of others) {
  const devs = devicesOf(m);
  if (devs.length && bundleId) fail(`${devs.join(", ")} run ${bundleId} from another checkout (:${m.port}, ${m.root ?? "unknown root"}). Your edits here will not show on that device.`);
}
if (others.some((m) => m.port === 8081) && mine.every((m) => m.port !== 8081)) {
  warn("Port 8081 (the default) belongs to another checkout. A plain `expo start` or a fresh dev build will talk to that one.");
}

// ---------- 4. Native build freshness ----------
head("Native build");
// The simulators that matter: the ones this checkout's Metro serves, else every booted one.
const mineDevices = new Set(mine.flatMap(devicesOf));
const installs = [];
if (bundleId && booted.length) {
  for (const d of booted) {
    const appPath = sh("xcrun", ["simctl", "get_app_container", d.udid, bundleId, "app"]);
    if (!appPath) { info(`not installed on ${d.name}`); continue; }
    const t = mtime(path.join(appPath, "Info.plist")) || mtime(appPath);
    installs.push({ device: d, appPath, t });
    info(`installed on ${d.name}, binary from ${when(t)}`);
  }
}
const targets = installs.some((i) => mineDevices.has(i.device.name)) ? installs.filter((i) => mineDevices.has(i.device.name)) : installs;
const builtAt = targets.length ? Math.min(...targets.map((i) => i.t)) : 0;

// 4a. Native packages the app depends on.
const pkg = readJson(path.join(appDir, "package.json")) || {};
const deps = Object.keys({ ...(pkg.dependencies || {}) });
const req = createRequire(path.join(appDir, "package.json"));
function pkgDir(name) {
  try { return path.dirname(req.resolve(`${name}/package.json`)); } catch { /* exports may hide package.json */ }
  for (let d = appDir; ; d = path.dirname(d)) {
    const c = path.join(d, "node_modules", name);
    if (fs.existsSync(path.join(c, "package.json"))) return c;
    if (path.dirname(d) === d) return null;
  }
}
function podspecs(dir) {
  const out = [];
  for (const sub of ["", "ios", "apple"]) {
    const d = path.join(dir, sub);
    try { for (const f of fs.readdirSync(d)) if (f.endsWith(".podspec")) out.push(f.replace(/\.podspec$/, "")); } catch { /* none */ }
  }
  return out;
}
const native = [];
for (const name of deps) {
  const d = pkgDir(name);
  if (!d) continue;
  const pods = podspecs(d);
  if (pods.length) native.push({ name, pods });
}
info(`${native.length} of ${deps.length} dependencies have native iOS code`);

// 4b. Is each native package's code inside the installed binary?
// Debug builds keep the app's code in <Executable>.debug.dylib. Pod names show
// up in symbol names (RNSVG, ExpoImage, RNReanimated), so a count of zero means
// the binary was built without that package.
const UMBRELLA = new Set(["expo-dev-client"]); // pods with no code of their own
for (const i of targets) {
  const exe = sh("plutil", ["-extract", "CFBundleExecutable", "raw", "-o", "-", path.join(i.appPath, "Info.plist")]);
  const bin = [path.join(i.appPath, `${exe}.debug.dylib`), path.join(i.appPath, exe || "")].find((f) => exe && fs.existsSync(f));
  const syms = bin ? sh("nm", ["-U", bin], { timeout: 60000 }) : null;
  if (!syms || syms.length < 100000) { info(`${i.device.name}: binary has few or no symbols (a release build?). Symbol check skipped.`); continue; }
  const absent = native.filter((n) => !UMBRELLA.has(n.name) && !n.pods.some((p) => syms.includes(p) || syms.includes(p.replace(/-/g, "_"))));
  if (!absent.length) ok(`${i.device.name}: every native dependency has code in the installed binary`);
  else warn(`${i.device.name}: no code found in the installed binary for ${absent.map((a) => a.name).join(", ")}. The binary was likely built before they were added, or by another checkout. Rebuild: npx expo run:ios. (If a rebuild does not clear this, the pod name differs from its symbols; confirm with: nm -U "${bin}" | grep -ci <name>)`);
}

// 4c. CocoaPods state in ios/, when the folder exists.
const lockPath = path.join(appDir, "ios", "Podfile.lock");
if (fs.existsSync(lockPath)) {
  const lock = fs.readFileSync(lockPath, "utf8");
  const missing = native.filter((n) => !n.pods.some((p) => new RegExp(`^  - "?${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ /("]`, "m").test(lock)));
  if (missing.length) fail(`Native packages not in ios/Podfile.lock: ${missing.map((m) => m.name).join(", ")}. Reload cannot load them. Rebuild: npx expo run:ios`);
  else ok("Every native dependency is in ios/Podfile.lock");
  const lockT = mtime(lockPath);
  if (builtAt && lockT > builtAt + 60000) fail(`ios/Podfile.lock (${when(lockT)}) is newer than the installed binary (${when(builtAt)}). Pods changed after the last build. Rebuild: npx expo run:ios`);
} else {
  info("No ios/ folder (Continuous Native Generation). The Podfile check is skipped; the fingerprint check below still works.");
}

// 4d. Other native inputs that changed after the binary was built.
if (builtAt) {
  const inputs = [...APP_FILES, "eas.json", "patches", "plugins", "targets", "widgets", "modules"].map((f) => path.join(appDir, f)).filter((f) => fs.existsSync(f));
  const newer = inputs.filter((f) => mtime(f) > builtAt + 60000).map((f) => path.relative(appDir, f));
  if (newer.length) warn(`Changed after the binary was built: ${newer.join(", ")}. If the change is native (plugins, permissions, entitlements, native code), rebuild. A version or JS-only field does not need one.`);
}

// 4e. Expo fingerprint: a hash of every native input.
const markFile = path.join(appDir, ".expo", "dev-loop-fingerprint.json");
if (opt.fingerprint || opt.markBuilt) {
  let cli = null;
  try { cli = path.join(path.dirname(req.resolve("@expo/fingerprint/package.json")), "bin", "cli.js"); } catch { /* not installed */ }
  const out = cli && fs.existsSync(cli) ? sh(process.execPath, [cli, "fingerprint:generate", appDir], { timeout: 120000 }) : null;
  let hash = null;
  try { hash = JSON.parse(out).hash; } catch { /* no hash */ }
  if (!hash) {
    info("@expo/fingerprint not available. Skipping the fingerprint check.");
  } else if (opt.markBuilt) {
    fs.mkdirSync(path.dirname(markFile), { recursive: true });
    fs.writeFileSync(markFile, JSON.stringify({ hash, at: new Date().toISOString(), head: sh("git", ["-C", appDir, "rev-parse", "HEAD"]) }, null, 2) + "\n");
    ok(`Recorded native fingerprint ${hash.slice(0, 12)} in .expo/dev-loop-fingerprint.json`);
  } else {
    const mark = readJson(markFile);
    if (!mark) info(`Fingerprint ${hash.slice(0, 12)}. No baseline yet. After the next native build, run this script with --mark-built.`);
    else if (mark.hash === hash) ok(`Native fingerprint unchanged since the build marked at ${mark.at.slice(0, 16)} UTC`);
    else fail(`Native fingerprint changed since the build marked at ${mark.at.slice(0, 16)} UTC. A reload will not pick this up. Rebuild: npx expo run:ios, then run with --mark-built`);
  }
}

// ---------- Verdict ----------
console.log("");
if (fails) console.log(`PREFLIGHT FAIL (${fails} fail, ${warns} warn). Fix these before you debug the app.`);
else if (warns) console.log(`PREFLIGHT OK WITH WARNINGS (${warns}). Read them before you trust what the simulator shows.`);
else console.log("PREFLIGHT OK. The simulator runs this checkout, and the binary is current.");
process.exit(fails ? 1 : 0);
