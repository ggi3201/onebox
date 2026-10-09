#!/usr/bin/env node
// Check that every feature in FEATURES.md is built: each one has a flow
// (*.flow.md) that covers it, and that flow passed on the current code.
//
//   node features.mjs sync [--repo <dir>] [--plan PLAN.md] [--add <json list|@file>]
//       Creates or updates FEATURES.md. Adds the features the plan's items
//       promise (catalog.json, `proves`), and the app's own features from
//       --add (one short line each). Never removes or rewrites a line: the
//       user owns the file.
//
//   node features.mjs check [--repo <dir>]
//       Read-only. Prints JSON: each feature's state, each flow, and a `say`
//       line with the next gap. Exit 0 when every feature is done, 1 when not,
//       3 when there is no FEATURES.md.
//
//   node features.mjs record --flow <path> (--pass | --fail --step <n>) [--note <text>] [--repo <dir>]
//       After the agent runs a flow, saves the result in
//       .onebox/runs/<flow>.json, with a fingerprint of the flow file and of
//       the code its `Feature:` line names.
//
// The states, from worst to best:
//   missing   no flow has a `Covers:` line with the feature's id
//   failed    a flow that covers it failed its last run
//   unproven  a flow that covers it has never run
//   stale     every flow passed, but a flow or its code changed since
//   done      every flow that covers it passed on the current code
//
// The check reads files only. It runs no command and no app code, so the
// same files always give the same answer. Node 18+, no dependencies.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The plan skill sits next to this one, in the same plugin.
const CATALOG = path.join(HERE, "..", "..", "plan", "references", "catalog.json");
// The first line remembers which plan features sync has added, so a line the
// user deleted does not come back: <!-- onebox-features v1 {"offered":[...]} -->
const MARK_RE = /^<!-- onebox-features v1(?: (\{.*\}))? -->$/;
const mark = (offered) => `<!-- onebox-features v1 ${JSON.stringify({ offered })} -->`;
const APP = "## What the app does";
const KIT = "## From your plan";
const LINE_RE = /^- (.*?)\s*<!-- feature:([a-z0-9][a-z0-9-]*) -->\s*$/;
const SKIP = new Set(["node_modules", "ios", "android", "build", "dist", "coverage", "bin", "obj", "Pods", "DerivedData"]);
const RANK = ["missing", "failed", "unproven", "stale", "done"];
const NEXT = ["failed", "stale", "unproven", "missing", "done"];

// ---------- files ----------

const readText = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };
const isDir = (f) => { try { return fs.statSync(f).isDirectory(); } catch { return false; } };
const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const rel = (repo, f) => path.relative(repo, f).split(path.sep).join("/");

// Every file under dir, sorted, without dot files and build folders.
function walk(dir, test = () => true, depth = 12, out = []) {
  if (depth < 0) return out;
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of ents) {
    if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, test, depth - 1, out);
    else if (e.isFile() && test(e.name)) out.push(p);
  }
  return out;
}

// ---------- FEATURES.md ----------

function readFeatures(repo) {
  const text = readText(path.join(repo, "FEATURES.md"));
  if (text == null) return null;
  const features = [];
  let meta = {};
  try { meta = JSON.parse(text.split("\n")[0].match(MARK_RE)?.[1] ?? "{}"); } catch {}
  let section = null;
  for (const line of text.split("\n")) {
    if (/^## /.test(line)) section = line.trim();
    const m = line.match(LINE_RE);
    if (m && !features.some((f) => f.id === m[2])) features.push({ id: m[2], text: m[1], kit: section === KIT });
  }
  return { text, features, meta };
}

// A short name for the nudge: a plan line is "<title>. Proof: <what>".
const shortName = (f) => f.text.replace(/\.? Proof: .*$/, "").replace(/\.$/, "");

// Small words carry no meaning in an id: "Add a receipt with a photo" is add-receipt-photo.
const SMALL = new Set("a an the my me i we you your our it its and or of to for from in on at by with as is are be can should so that this".split(" "));
function baseId(s) {
  const words = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const big = words.filter((w) => !SMALL.has(w));
  const id = (big.length ? big : words).slice(0, 3).join("-");
  if (id) return id;
  // No Latin letters or digits (Japanese, Arabic, ...): an id from the text's
  // hash, so two such lines do not both become "feature".
  return "f-" + crypto.createHash("sha1").update(s.normalize("NFC").toLowerCase()).digest("hex").slice(0, 8);
}

// The plan file. PLAN.md, unless the user kept their own PLAN.md and the
// plan went to another file with --out: then the root .md file that starts
// with the onebox mark. Without this, later runs forgot that file.
function findPlan(dir) {
  const isOnebox = (f) => { try { return fs.readFileSync(path.join(dir, f), "utf8").startsWith("<!-- onebox-plan v1"); } catch { return false; } };
  if (isOnebox("PLAN.md")) return "PLAN.md";
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "PLAN.md").sort(); } catch { /* no folder */ }
  return names.find(isOnebox) ?? "PLAN.md";
}

// The plan's items that promise a feature: catalog items with `proves`.
function kitFeatures(repo, planFile) {
  const plan = readText(path.resolve(repo, planFile));
  if (plan == null) return [];
  const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  const keyOf = (it) => (it.kind === "guide" ? `guide:${it.slug ?? it.id}` : `skill:${it.plugin}/${it.slug ?? it.id}`);
  // Items under "Kept from your old plan" no longer fit the answers.
  const active = plan.split("\n## Kept from your old plan")[0];
  const keys = new Set([...active.matchAll(/^- \[[ xX]\] .*<!-- ((?:guide|skill):\S+) -->\s*$/gm)].map((m) => m[1]));
  const out = [];
  for (const it of catalog.items) {
    if (!it.proves || !keys.has(keyOf(it))) continue;
    const id = it.slug ?? it.id;
    if (!out.some((f) => f.id === id)) out.push({ id, text: `${it.nudge ?? it.title}. Proof: ${it.proves}` });
  }
  return out;
}

function syncMode(flags) {
  const repo = path.resolve(flags.repo ?? ".");
  const file = path.join(repo, "FEATURES.md");
  const old = readFeatures(repo);
  let add = [];
  if (flags.add) {
    const raw = flags.add.startsWith("@") ? fs.readFileSync(flags.add.slice(1), "utf8") : flags.add;
    try { add = JSON.parse(raw); } catch (e) { die(`--add is not valid JSON: ${e.message}`); }
    if (!Array.isArray(add) || add.some((x) => typeof x !== "string")) die("--add must be a JSON list of strings");
    add = add.map((s) => s.replace(/\s+/g, " ").replace(/<!--.*?-->/g, "").trim()).filter(Boolean);
  }
  const taken = new Set(old?.features.map((f) => f.id) ?? []);
  const known = new Set(old?.features.map((f) => f.text.toLowerCase()) ?? []);
  const offered = [...(old?.meta.offered ?? old?.features.filter((f) => f.kit).map((f) => f.id) ?? [])];
  const kit = kitFeatures(repo, flags.plan ?? findPlan(repo)).filter((f) => !offered.includes(f.id) && !taken.has(f.id) && taken.add(f.id));
  offered.push(...kit.map((f) => f.id));
  const app = [], skipped = [];
  // A line that is already there, by its words or by its id, is not added
  // again. The user may have changed its words since. A skip by id is said
  // out loud: it can also be a new feature whose first words match an old one.
  for (const s of add) {
    const id = baseId(s);
    if (known.has(s.toLowerCase())) continue;
    if (taken.has(id)) { skipped.push({ id, text: s }); continue; }
    known.add(s.toLowerCase()); taken.add(id);
    app.push({ id, text: s });
  }
  const line = (f) => `- ${f.text} <!-- feature:${f.id} -->`;

  let text;
  if (!old) {
    text = [
      mark(offered),
      "# Features",
      "",
      "What the app must do. `/start:check-features` checks that each feature has a",
      "flow (`*.flow.md`) whose `Covers:` line names its id, and that the flow passed",
      "on the current code. Change the words of a line as you like. Keep its",
      "`<!-- feature:... -->` mark: flows name the feature by that id. Delete a line",
      "to drop the feature. It does not come back.",
      "",
      APP,
      "",
      ...app.map(line),
      "",
      KIT,
      "",
      ...kit.map(line),
      "",
    ].join("\n").replace(/\n{3,}/g, "\n\n");
  } else {
    // Add new lines at the end of their section. The rest stays byte for byte.
    const lines = old.text.replace(/\n+$/, "").split("\n");
    const insert = (heading, items) => {
      if (!items.length) return;
      let i = lines.findIndex((l) => l.trim() === heading);
      if (i < 0) { lines.push("", heading, ""); i = lines.length - 2; }
      let end = i + 2;
      for (let j = i + 1; j < lines.length && !/^## /.test(lines[j]); j++) if (LINE_RE.test(lines[j])) end = j + 1;
      lines.splice(Math.min(end, lines.length), 0, ...items.map(line));
      // A section that follows needs its blank line.
      const after = Math.min(end, lines.length) + items.length;
      if (after < lines.length && lines[after].trim()) lines.splice(after, 0, "");
    };
    insert(APP, app);
    insert(KIT, kit);
    if (MARK_RE.test(lines[0])) lines[0] = mark(offered);
    else lines.unshift(mark(offered));
    text = lines.join("\n") + "\n";
  }
  if (text !== old?.text) fs.writeFileSync(file, text);
  const all = readFeatures(repo).features;
  console.log(`FEATURES.md: ${!old ? "written" : text === old.text ? "unchanged" : "updated"}. ${all.length} features (${all.filter((f) => !f.kit).length} from the app, ${all.filter((f) => f.kit).length} from the plan).`);
  for (const f of [...app, ...kit]) console.log(`  added ${f.id}: ${f.text}`);
  for (const f of skipped) console.log(`  NOT added: "${f.text}" gets the id ${f.id}, which a line already has. If it is a new feature, start it with other words.`);
}

// ---------- flows ----------

// The app folder a flow belongs to: the nearest folder up with a package.json.
function appRoot(repo, flowFile) {
  for (let d = path.dirname(flowFile); d.startsWith(repo); d = path.dirname(d)) {
    if (isFile(path.join(d, "package.json"))) return d;
    if (d === repo) break;
  }
  return repo;
}

// Header lines before the first step: "Feature: a/, b.ts", "Covers: x, y".
function header(text) {
  const h = {};
  let last = null;
  for (const line of text.split("\n")) {
    if (/^## |^\d+\. /.test(line)) break;
    const m = line.match(/^([A-Z][A-Za-z ]*):\s*(.*)$/);
    if (m) { last = m[1].toLowerCase(); h[last] = m[2]; }
    else if (last && line.trim() && !/^#/.test(line)) h[last] += " " + line.trim();
    else last = null;
  }
  return h;
}
const tokens = (s) => (s ?? "").split(/[,\s]+/).map((t) => t.replace(/[`"'.;:]+$/g, "").replace(/^[`"']+/, "")).filter(Boolean);

function readFlow(repo, file) {
  const text = readText(file) ?? "";
  const h = header(text);
  const root = appRoot(repo, file);
  // A Feature path is relative to the app folder; else to the repo root.
  // "/api/account" is a route, not a file.
  const paths = tokens(h.feature).filter((t) => /[/.]/.test(t) && !t.startsWith("/")).map((t) => {
    const a = path.join(root, t), b = path.join(repo, t);
    return { token: t, abs: fs.existsSync(a) ? a : fs.existsSync(b) ? b : null };
  });
  return {
    file,
    path: rel(repo, file),
    title: (text.match(/^# (.+)$/m)?.[1] ?? path.basename(file)).trim(),
    covers: tokens(h.covers).map((t) => t.replace(/^feature:/, "")),
    paths,
  };
}

// A hash of the flow file and every file its Feature line names. Content
// only, so a commit, a checkout or the clock does not change it.
function fingerprint(repo, flow) {
  const files = new Set([flow.file]);
  for (const p of flow.paths) {
    if (!p.abs) continue;
    if (isDir(p.abs)) for (const f of walk(p.abs)) files.add(f);
    else files.add(p.abs);
  }
  const h = crypto.createHash("sha256");
  for (const f of [...files].sort()) {
    h.update(rel(repo, f) + "\0");
    h.update(crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") + "\n");
  }
  for (const p of flow.paths) if (!p.abs) h.update(`missing:${p.token}\n`);
  return h.digest("hex").slice(0, 16);
}

const runFile = (repo, flowPath) => path.join(repo, ".onebox", "runs", flowPath.replace(/\.flow\.md$/, "").replace(/[\\/]/g, "__") + ".json");

// ---------- check ----------

export function checkFeatures(repoDir = ".") {
  const repo = path.resolve(repoDir);
  const spec = readFeatures(repo);
  if (!spec) return null;
  const flows = walk(repo, (n) => n.endsWith(".flow.md")).map((f) => readFlow(repo, f));
  const ids = new Set(spec.features.map((f) => f.id));

  const flowState = new Map();
  for (const fl of flows) {
    let run = null;
    try { run = JSON.parse(fs.readFileSync(runFile(repo, fl.path), "utf8")); } catch {}
    const now = fingerprint(repo, fl);
    const state = !run ? "unproven" : run.result !== "pass" ? "failed" : run.fingerprint !== now ? "stale" : "done";
    flowState.set(fl.path, {
      flow: fl.path, title: fl.title, covers: fl.covers, state,
      lastRun: run ? { result: run.result, step: run.step ?? null, note: run.note ?? null, commit: run.commit ?? null, date: run.date ?? null } : null,
      noFeatureLine: !fl.paths.length,
      missingPaths: fl.paths.filter((p) => !p.abs).map((p) => p.token),
    });
  }

  const features = spec.features.map((f) => {
    const mine = flows.filter((fl) => fl.covers.includes(f.id)).map((fl) => flowState.get(fl.path));
    const state = !mine.length ? "missing" : RANK[Math.min(...mine.map((s) => RANK.indexOf(s.state)))];
    return { id: f.id, text: f.text, name: shortName(f), from: f.kit ? "plan" : "app", state, flows: mine.map((s) => s.flow) };
  });
  const done = features.filter((f) => f.state === "done").length;
  return {
    total: features.length,
    done,
    allDone: features.length > 0 && done === features.length,
    features,
    flows: [...flowState.values()],
    unknownCovers: flows.flatMap((fl) => fl.covers.filter((c) => !ids.has(c)).map((c) => ({ flow: fl.path, id: c }))),
    flowsWithoutCovers: flows.filter((fl) => !fl.covers.length).map((fl) => fl.path),
    summary: `${done} of ${features.length} features proven.`,
    say: sayFor(features, flowState),
  };
}

function sayFor(features, flowState) {
  if (!features.length) return "FEATURES.md lists no features yet. Tell me what the app should do, one line per thing.";
  // Something that broke first, then what may have broken, then what was
  // never proven, then what has no flow. Inside a state, the order of the file.
  const gap = [...features].sort((a, b) => NEXT.indexOf(a.state) - NEXT.indexOf(b.state))[0];
  const flowOf = (st) => gap.flows.map((p) => flowState.get(p)).find((s) => s.state === st);
  const name = (s) => path.basename(s.flow);
  switch (gap.state) {
    case "missing": return `Next: write a flow that proves "${gap.name}". Continue?`;
    case "failed": {
      const s = flowOf("failed");
      return `Next: fix "${gap.name}". ${name(s)} failed${s.lastRun.step ? ` at step ${s.lastRun.step}` : ""}. Continue?`;
    }
    case "unproven": return `Next: run ${name(flowOf("unproven"))} to prove "${gap.name}". Continue?`;
    case "stale": return `Next: run ${name(flowOf("stale"))} again. "${gap.name}" changed since it passed. Continue?`;
    default: return "Every feature works: each one has a flow that passed on the current code.";
  }
}

function checkMode(flags) {
  const r = checkFeatures(flags.repo ?? ".");
  if (!r) {
    console.log(JSON.stringify({ found: false, say: "No FEATURES.md in this repo. Run /start:plan to make one." }, null, 2));
    process.exit(3);
  }
  console.log(JSON.stringify({ found: true, ...r }, null, 2));
  process.stderr.write(`${r.summary}\n${r.say}\n`);
  process.exit(r.allDone ? 0 : 1);
}

// ---------- record ----------

function recordMode(flags) {
  const repo = path.resolve(flags.repo ?? ".");
  if (!flags.flow) die("record needs --flow <path to the .flow.md>");
  if (!!flags.pass === !!flags.fail) die("record needs --pass or --fail");
  if (flags.fail && !flags.step) die("--fail needs --step <n>: the step that failed");
  const file = path.resolve(repo, flags.flow);
  if (!isFile(file) || !file.endsWith(".flow.md")) die(`${flags.flow} is not a .flow.md file`);
  const fl = readFlow(repo, file);
  const git = spawnSync("git", ["-C", repo, "rev-parse", "--short", "HEAD"], { encoding: "utf8", timeout: 5000 });
  const run = {
    flow: fl.path,
    result: flags.pass ? "pass" : "fail",
    step: flags.fail ? (Number(flags.step) || flags.step) : null,
    note: flags.note ?? null,
    covers: fl.covers,
    fingerprint: fingerprint(repo, fl),
    commit: git.status === 0 ? git.stdout.trim() : null,
    date: new Date().toISOString().slice(0, 10),
  };
  const out = runFile(repo, fl.path);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(run, null, 2) + "\n");
  console.log(`${rel(repo, out)}: ${run.result}${run.step ? ` at step ${run.step}` : ""}. Covers ${fl.covers.join(", ") || "nothing (the flow has no Covers: line)"}.`);
}

// ---------- main ----------

function die(msg, code = 2) { process.stderr.write(`features.mjs: ${msg}\n`); process.exit(code); }

// Compare real paths: run through a symlink, argv[1] and import.meta.url
// differ, and every mode would print nothing and exit 0 ("all done").
const realArgv1 = (() => { try { return fs.realpathSync(process.argv[1]); } catch { return path.resolve(process.argv[1] ?? ""); } })();
if (process.argv[1] && fs.realpathSync(fileURLToPath(import.meta.url)) === realArgv1) {
  const [mode, ...rest] = process.argv.slice(2);
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) die(`unexpected argument ${a}`);
    const k = a.slice(2);
    if (["pass", "fail"].includes(k)) flags[k] = true;
    else { if (rest[i + 1] == null) die(`${a} needs a value`); flags[k] = rest[++i]; }
  }
  if (mode === "sync") syncMode(flags);
  else if (mode === "check") checkMode(flags);
  else if (mode === "record") recordMode(flags);
  else die("first argument must be `sync`, `check` or `record`");
}
