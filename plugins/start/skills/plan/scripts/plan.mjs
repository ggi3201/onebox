#!/usr/bin/env node
// Turn answers plus detect.mjs output into PLAN.md, using references/catalog.json.
//
//   node plan.mjs questions [--answers <json|@file>] [--detect <file|->] [--repo <dir>]
//       Prints JSON: which answers detection gives, which questions to ask,
//       which to skip because they do not change the plan, and `conflicts`:
//       known answers that do not work together (catalog.json `conflicts`).
//
//   node plan.mjs write [--answers <json|@file>] [--detect <file|->] [--repo <dir>]
//                       [--out PLAN.md] [--dry-run] [--convert]
//       Writes PLAN.md in the repo root. If a onebox PLAN.md is there, it merges:
//       your ticks, notes and extra lines are kept, newly detected items are ticked.
//       A PLAN.md in another format is left alone (exit 3) unless --convert is
//       given; then its text is kept under "Kept from your old plan".
//       It prints a "Check:" line for each conflict and a "Warning:" line for
//       each warning in the answers.
//       --dry-run prints the file instead of writing it.
//
//   node plan.mjs ready [--answers <json|@file>] [--detect <file|->] [--repo <dir>]
//                       [--out PLAN.md] [--all] [--list] [--step <item id>] [--need <id,id>]
//       Finds the next step the way `write` does, and checks only what that
//       step needs (references/needs.json). Prints JSON with a `say` line:
//       the next step, and at most one blocker. --all checks every step left.
//       --list says every need the step lacks, in one list with one question,
//       instead of the first blocker alone (used by /start:new-app).
//       --step checks one catalog item instead of the next one. --need checks
//       only these need ids; with --step it adds them. Read-only: it writes nothing, installs nothing and never
//       prints a secret or a config value.
//
// Answers look like {"backend":"box","login":"apple","ai":["chat"]}. A missing
// answer falls back to your earlier answer, then detection, then the catalog
// default. Without --detect it runs detect.mjs on the repo. Same input, same file.
// Node 18+, no dependencies.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadNeeds, loadConfig, checkNeeds, sayFor, listFor } from "./needs.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(fs.readFileSync(path.join(HERE, "..", "references", "catalog.json"), "utf8"));
const SITE = "https://onebox.lokkesveen.com";
const CONFIG_DOC = "https://github.com/ggi3201/onebox/blob/main/CONFIG.md";
const MARK = "<!-- onebox-plan v1 ";

// Config keys each path needs (CONFIG.md). Key names only, never values.
// A list inside the list means "any one of these": the skills that read the
// App Store Connect key take a path to the .p8 file or a secret reference.
const BOX_KEYS = ["box.type", "box.ssh", "box.domain", "box.appsDir", "box.tunnel", "box.tunnelName", "box.cloudflareTokenRef"];
const CONFIG_KEYS = [
  { keys: ["secrets.tool"] },
  { keys: ["apple.teamId", "apple.ascKeyId", "apple.ascIssuerId", ["apple.ascKeyRef", "apple.ascKeyPath"]] },
  { keys: ["expo.tokenRef", "expo.buildMode"] },
  { when: { paid: ["subs"] }, keys: ["revenuecat.apiKeyRef"] },
  { when: { backend: ["box"] }, keys: [...BOX_KEYS, "box.runnerLabel"] },
  { when: { site: ["yes"] }, keys: BOX_KEYS },
  { when: { ai: ["chat", "import"] }, keys: ["llm.baseUrl", "llm.model", "llm.keyRef", "tracing.otlpEndpoint", "tracing.authRef"] },
  { when: { ai: ["media"] }, keys: ["media.imageProvider", "media.videoProvider", "media.providers.kie.keyRef"] },
];
const HEADERS = { stage: "Stage", backend: "Server", login: "Sign-in", paid: "Payments", site: "Landing page", ai: "AI", remote: "Remote" };

// ---------- arguments ----------

function die(msg, code = 2) { process.stderr.write(`plan.mjs: ${msg}\n`); process.exit(code); }
const argv = process.argv.slice(2);
const mode = argv[0];
if (!["questions", "write", "ready"].includes(mode)) die("first argument must be `questions`, `write` or `ready`");
const flags = {};
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) die(`unexpected argument ${a}`);
  const k = a.slice(2);
  if (["dry-run", "convert", "all", "list"].includes(k)) flags[k] = true;
  else { if (argv[i + 1] == null) die(`${a} needs a value`); flags[k] = argv[++i]; }
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
const repo = path.resolve(flags.repo ?? ".");
const outPath = path.resolve(repo, flags.out ?? findPlan(repo));

const readArg = (v) => (v === "-" ? fs.readFileSync(0, "utf8") : v.startsWith("@") ? fs.readFileSync(v.slice(1), "utf8") : v);

function loadDetect() {
  if (flags.detect) {
    const t = flags.detect === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(flags.detect, "utf8");
    return JSON.parse(t);
  }
  const r = spawnSync(process.execPath, [path.join(HERE, "detect.mjs"), repo], { encoding: "utf8" });
  if (r.status !== 0) die(`detect.mjs failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

// ---------- answers ----------

const Q = new Map(catalog.questions.map((q) => [q.id, q]));
const optLabel = (q, id) => q.options.find((o) => o.id === id)?.label ?? id;

function normalize(qid, v) {
  const q = Q.get(qid);
  if (!q) die(`unknown question "${qid}". Known: ${[...Q.keys()].join(", ")}`);
  const ids = q.options.map((o) => o.id);
  if (q.multi) {
    const arr = (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).filter((x) => x !== "none");
    for (const x of arr) if (!ids.includes(x)) die(`"${x}" is not an option of ${qid}. Options: ${ids.join(", ")}`);
    return ids.filter((x) => arr.includes(x)); // catalog order, no duplicates
  }
  if (!ids.includes(v)) die(`"${v}" is not an option of ${qid}. Options: ${ids.join(", ")}`);
  return v;
}
function parseAnswers(raw) {
  if (!raw) return {};
  let j;
  try { j = JSON.parse(readArg(raw)); } catch (e) { die(`--answers is not valid JSON: ${e.message}`); }
  return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, normalize(k, v)]));
}

function resolveAnswers(explicit, old, detect) {
  const answers = {}, sources = {};
  for (const q of catalog.questions) {
    const d = detect.answers?.[q.id];
    const det = d && ["high", "likely"].includes(d.confidence) ? normalize(q.id, d.value) : undefined;
    let v, s;
    if (q.id in explicit) [v, s] = [explicit[q.id], "you"];
    else if (old?.answers && q.id in old.answers && old.sources?.[q.id] === "you") [v, s] = [normalize(q.id, old.answers[q.id]), "you"];
    else if (det !== undefined) [v, s] = [det, "detected"];
    else [v, s] = [normalize(q.id, q.default), "default"];
    answers[q.id] = v; sources[q.id] = s;
  }
  return { answers, sources };
}

// ---------- the catalog ----------

const slugOf = (it) => it.slug ?? it.id;
const keyOf = (it) => (it.kind === "guide" ? `guide:${slugOf(it)}` : `skill:${it.plugin}/${slugOf(it)}`);
const matches = (when, ans) => !when || Object.entries(when).every(([qid, opts]) => {
  const v = ans[qid];
  return Array.isArray(v) ? v.some((x) => opts.includes(x)) : opts.includes(v);
});
function selectItems(ans) {
  const seen = new Set(), out = [];
  for (const it of catalog.items) {
    if (!matches(it.when, ans)) continue;
    const k = keyOf(it);
    if (seen.has(k)) continue;
    seen.add(k); out.push(it);
  }
  return out;
}
// Answers that do not work together (catalog `conflicts`): AI with no server
// would ship the AI key inside the app. Only rules whose questions all have
// an answer count, so a question not yet asked never raises one.
const conflictsFor = (ans) => (catalog.conflicts ?? [])
  .filter((c) => c.ids.every((id) => id in ans) && matches(c.when, ans) && !(c.unless && matches(c.unless, ans)))
  .map(({ id, ids, level, say }) => ({ id, ids, level, say }));
// Which items are in the plan, in which phase, and which of them start ticked
// as likely done. A question that changes any of these changes the plan, so it
// is asked.
const itemSig = (ans) => selectItems(ans).map((it) => `${keyOf(it)}@${it.phase}${it.doneWhen && matches(it.doneWhen, ans) ? "+" : ""}`).join("|");

// A config key entry is a name, or a list of names where any one will do.
const keyNames = (k) => (Array.isArray(k) ? k : [k]);
const keyLabel = (k, fmt = (n) => n) => keyNames(k).map(fmt).join(" or ");
const keyIsSet = (k, set) => keyNames(k).some((n) => set.has(n));

// ---------- questions mode ----------

function subsets(ids) {
  const out = [[]];
  for (const id of ids) for (const s of out.slice()) out.push([...s, id]);
  return out;
}
const choices = (q) => (q.multi ? subsets(q.options.map((o) => o.id)) : q.options.map((o) => o.id));
// Does this question matter, given the other answers? Remote access, for
// example, only matters with your own box. PLAN.md lists only the answers
// that matter.
const applies = (q, answers) => {
  const sig = itemSig(answers);
  return choices(q).some((c) => itemSig({ ...answers, [q.id]: c }) !== sig);
};

function questionsMode() {
  const detect = loadDetect();
  const explicit = parseAnswers(flags.answers);
  const old = readOldPlan()?.meta;
  const known = { ...explicit };
  const state = [];
  for (const q of catalog.questions) {
    if (q.id in known) continue;
    if (old?.sources?.[q.id] === "you" && q.id in (old.answers ?? {})) { known[q.id] = normalize(q.id, old.answers[q.id]); continue; }
    const d = detect.answers?.[q.id];
    if (d?.confidence === "high") {
      known[q.id] = normalize(q.id, d.value);
      state.push({ id: q.id, question: q.q, answer: labelOf(q, known[q.id]), why: d.why });
    }
  }
  const unknown = catalog.questions.filter((q) => !(q.id in known));
  const ask = [], skipped = [];
  for (const q of unknown) {
    const others = unknown.filter((o) => o !== q);
    let relevant = false;
    const rec = (i, ans) => {
      if (relevant) return;
      if (i === others.length) {
        const sigs = new Set(choices(q).map((c) => itemSig({ ...ans, [q.id]: c })));
        if (sigs.size > 1) relevant = true;
        return;
      }
      for (const c of choices(others[i])) rec(i + 1, { ...ans, [others[i].id]: c });
    };
    rec(0, { ...known });
    if (!relevant) { skipped.push({ id: q.id, why: "no answer changes the plan" }); continue; }
    const d = detect.answers?.[q.id];
    // A detected multi answer with no value only means "AI is in the code, kind unknown".
    const useDet = d && (!q.multi || d.value.length);
    const first = useDet ? d.value : q.default;
    const tag = useDet ? "(detected)" : "(recommended)";
    let options = q.options.map((o) => ({ id: o.id, label: o.label }));
    if (q.multi) {
      options.push({ id: "none", label: "None of these" });
      const firstSet = new Set(first);
      options = [...options.filter((o) => firstSet.has(o.id)), ...options.filter((o) => !firstSet.has(o.id))];
      for (const o of options) if (firstSet.has(o.id)) o.tag = tag;
    } else {
      options = [...options.filter((o) => o.id === first), ...options.filter((o) => o.id !== first)];
      options[0].tag = tag;
    }
    ask.push({ id: q.id, header: HEADERS[q.id] ?? q.id, question: q.q, hint: q.hint, multi: !!q.multi, why: d?.why, options });
  }
  console.log(JSON.stringify({ state, ask, skipped, conflicts: conflictsFor(known) }, null, 2));
}
const labelOf = (q, v) => (Array.isArray(v) ? (v.length ? v.map((x) => optLabel(q, x)).join("; ") : "None") : optLabel(q, v));

// ---------- render ----------

function itemText(it) {
  const s = slugOf(it);
  const link = it.kind === "guide"
    ? `guide: ${SITE}/guides/${s}/ (raw: ${SITE}/guides/${s}.md)`
    : `skill: /${it.plugin}:${s}`;
  return `${it.title} — ${link} <!-- ${keyOf(it)} -->`;
}
const KEPT = "## Kept from your old plan";
const KEPT_INTRO = "Items and notes that no longer fit your answers. Delete them yourself when you do not need them.";

// Returns sections: [{ heading, lines: [{ text, item? }] }]. An item line carries
// { key, done, note }. Static lines depend only on the answers.
function render(answers, sources, detect) {
  const secs = [];
  const sec = (heading, lines = []) => { const s = { heading, lines: lines.map((t) => ({ text: t })) }; secs.push(s); return s; };

  sec("# Plan", [
    "Made by `/start:plan` from onebox. Tick items as you go. Add notes anywhere: the next run keeps them.",
    "To change an answer, run `/start:plan` again and say which one.",
  ]);
  const clash = conflictsFor(answers);
  sec("## Your answers", [
    ...catalog.questions.filter((q) => applies(q, answers)).map((q) => `- ${q.q} **${labelOf(q, answers[q.id])}** (${sources[q.id]})`),
    ...(clash.length ? ["", ...clash.map((c) => `**${c.level === "conflict" ? "Warning" : "Note"}:** ${c.say}`)] : []),
  ]);

  const items = selectItems(answers);
  const plugins = [];
  // start is already installed: it is what runs this script.
  for (const it of items) if (it.kind === "skill" && it.plugin !== "start" && !plugins.includes(it.plugin)) plugins.push(it.plugin);
  sec("## Install", [
    "Only the plugins this plan uses. In Claude Code:",
    "",
    "```",
    ...plugins.map((p) => `/plugin install ${p}@onebox`),
    "```",
    "",
    "In Codex: `codex plugin add <plugin>@onebox` for each of them.",
    "",
    "Other agents (Cursor, Gemini CLI): `npx skills add ggi3201/onebox` installs every skill.",
  ]);

  const set = new Set([...(detect.config?.user?.keysSet ?? []), ...(detect.config?.project?.keysSet ?? [])]);
  const keys = [];
  for (const g of CONFIG_KEYS) if (matches(g.when, answers)) for (const k of g.keys) if (!keys.some((x) => keyLabel(x) === keyLabel(k))) keys.push(k);
  sec("## Config keys", [
    `Skills read these from \`~/.config/onebox/config.json\`, or \`.onebox.json\` for this app. Never put a secret value there, only a reference. See ${CONFIG_DOC}.`,
    "",
    ...keys.map((k) => `- ${keyLabel(k, (n) => `\`${n}\``)} — ${keyIsSet(k, set) ? "set" : "not set"}`),
  ]);

  for (const ph of catalog.phases) {
    const its = items.filter((it) => it.phase === ph.id);
    if (!its.length) continue;
    const s = sec(`## ${ph.title}`);
    for (const it of its) {
      const k = keyOf(it);
      // Detection wins. Otherwise an answer can mark an item as likely done
      // (an app already on TestFlight has an Apple account and Xcode), unless
      // detection sees what is still missing ("open").
      const likely = !detect.done?.[k] && !detect.open?.[k] && it.doneWhen && matches(it.doneWhen, answers)
        ? `you answered "${labelOf(catalog.questions.find((q) => q.id === Object.keys(it.doneWhen)[0]), answers[Object.keys(it.doneWhen)[0]])}"`
        : undefined;
      s.lines.push({ text: itemText(it), item: { key: k, done: detect.done?.[k], likely, found: detect.open?.[k] ?? detect.seen?.[k], open: !!detect.open?.[k], repeat: !!it.repeat } });
    }
  }
  sec("## Notes", ["Your own notes. The planner never changes them."]);
  return { secs, items, plugins, keys };
}

// ---------- read an existing plan ----------

function readOldPlan() {
  let text;
  try { text = fs.readFileSync(outPath, "utf8"); } catch { return null; }
  if (!text.startsWith(MARK)) return { foreign: true, text };
  const first = text.slice(0, text.indexOf("\n") >>> 0);
  let meta = {};
  try { meta = JSON.parse(first.slice(MARK.length, first.lastIndexOf(" -->"))); } catch {}
  return { foreign: false, text, meta };
}

const ITEM_RE = /^\s*- \[( |x|X)\] (.*<!-- ((?:guide|skill):\S+) -->)\s*$/;
const NOTE_RE = /^ {2}- (detected|likely done|found): /;
const GEN_RE = [
  /^- `[\w.]+`( or `[\w.]+`)* — (set|not set)$/,
  /^\/plugin install \S+@onebox$/,
  /^- .+ \*\*.*\*\* \((you|detected|default)\)$/,
];

// Split an old plan into its onebox items and the user's own text.
// User text is grouped in blocks, each anchored to the generated line before it.
// A block keeps the blank lines before and after its text: they are the
// user's too. mergeBlanks() below puts them back without doubling the
// planner's own blank lines.
function parseOld(text, staticLines, genHeadings) {
  const lines = text.split("\n").slice(1);
  const items = new Map();
  const blocks = [];
  let heading = "# Plan", anchor = { type: "heading" }, occ = new Map(), cur = null, curItem = null, blanks = [];
  const flush = () => {
    if (cur) blocks.push(cur);
    cur = null; blanks = [];
  };
  for (const line of lines) {
    const m = line.match(ITEM_RE);
    if (m) {
      flush();
      curItem = { key: m[3], ticked: m[1] !== " ", body: m[2], line, autoTicked: false };
      if (!items.has(m[3])) items.set(m[3], curItem);
      anchor = { type: "item", key: m[3] };
      continue;
    }
    if (!line.trim()) { (cur ? cur.lines : blanks).push(line); continue; }
    if (NOTE_RE.test(line) && curItem && anchor.type === "item") {
      if (line.startsWith("  - detected: ") || line.startsWith("  - likely done: ")) curItem.autoTicked = true;
      blanks = [];
      continue;
    }
    if (genHeadings.has(line)) { flush(); heading = line; anchor = { type: "heading" }; occ = new Map(); curItem = null; continue; }
    if (GEN_RE.some((r) => r.test(line)) || staticLines.has(`${heading}\n${line}`)) {
      flush();
      const n = (occ.get(line) ?? 0) + 1; occ.set(line, n);
      anchor = { type: "line", text: line, n };
      continue;
    }
    if (!cur) cur = { heading, anchor, lines: blanks };
    cur.lines.push(line);
  }
  flush();
  return { items, blocks };
}

// Join output lines. A string is the planner's line; { user } is the user's.
// A run of blank lines becomes the user's blank lines, exactly, when the run
// has any; otherwise one blank line. Blank lines at the start and end go.
function mergeBlanks(out) {
  const lines = [];
  let run = null;
  for (const x of out) {
    const user = typeof x !== "string";
    const t = user ? x.user : x;
    if (!t.trim()) {
      run ??= [];
      if (user) run.push(t);
      continue;
    }
    if (run && lines.length) lines.push(...(run.length ? run : [""]));
    run = null;
    lines.push(t);
  }
  return lines.join("\n");
}

// ---------- write mode ----------

// Build the new PLAN.md text, and what a summary needs, without writing.
// `readonly` (for `ready`) reads a PLAN.md in another format as no plan.
function buildPlan({ readonly = false } = {}) {
  const detect = loadDetect();
  const explicit = parseAnswers(flags.answers);
  let old = readOldPlan();
  if (old?.foreign && readonly) old = null;
  if (old?.foreign && !flags.convert) {
    die(`${path.relative(repo, outPath) || "PLAN.md"} exists and was not made by /start:plan. Nothing written. ` +
      "Ask the user: keep it and write the plan to another file (--out ONEBOX-PLAN.md), " +
      "or convert it (--convert keeps all its text under \"Kept from your old plan\").", 3);
  }
  const { answers, sources } = resolveAnswers(explicit, old?.meta, detect);
  const { secs, items, plugins, keys } = render(answers, sources, detect);

  // Lines the planner owns: this render, plus the static lines of the old answers.
  // Keyed by heading: a line such as "```" is the planner's under Install, and
  // the user's own in their notes.
  const staticLines = new Set([`${KEPT}\n${KEPT_INTRO}`]);
  const genHeadings = new Set([KEPT, ...secs.map((s) => s.heading)]);
  const addStatic = (ss) => { for (const s of ss) { genHeadings.add(s.heading); for (const l of s.lines) if (!l.item) staticLines.add(`${s.heading}\n${l.text}`); } };
  addStatic(secs);
  if (old?.meta?.answers) {
    try { addStatic(render(old.meta.answers, old.meta.sources ?? {}, {}).secs); } catch {}
  }
  const parsed = old && !old.foreign ? parseOld(old.text, staticLines, genHeadings) : { items: new Map(), blocks: [] };
  if (old?.foreign) parsed.blocks.push({ heading: KEPT, anchor: { type: "kept" }, lines: old.text.replace(/\s+$/, "").split("\n") });

  // Build the output, section by section, placing the user's blocks.
  const newKeys = new Set(items.map(keyOf));
  const placed = new Set();
  const blocksFor = (pred) => parsed.blocks.filter((b, i) => !placed.has(i) && pred(b) && placed.add(i));
  const userLines = (b) => b.lines.map((user) => ({ user }));
  const out = [];
  let doneCount = 0, next = null;
  const left = [], newlyDone = [], tickedKeys = new Set(), autoKeys = [];
  const oldAuto = Array.isArray(old?.meta?.auto) ? new Set(old.meta.auto) : null;
  for (const s of secs) {
    out.push("", s.heading, "");
    out.push(...blocksFor((b) => b.heading === s.heading && b.anchor.type === "heading").flatMap(userLines));
    const occ = new Map();
    for (const l of s.lines) {
      if (l.item) {
        const { key, done, likely, found, open, repeat } = l.item;
        const prev = parsed.items.get(key);
        // A tick is the user's or the planner's. The header lists the planner's
        // (meta.auto); an older plan without that list falls back to its notes.
        // Keep the user's tick. The planner's tick lasts only while its reason
        // does: detection or an answer, and nothing seen still missing. Do not
        // tick again what the user unticked.
        const auto = !!done || !!likely;
        const prevOwned = !!prev?.ticked && (oldAuto ? oldAuto.has(key) : prev.autoTicked);
        const ticked = !prev ? auto
          : prev.ticked ? (prevOwned ? auto && !open : true)
          : auto && !prev.autoTicked;
        if (ticked && (!prev || !prev.ticked || prevOwned)) autoKeys.push(key);
        const fresh = l.text;
        const body = prev && !staticLooksGenerated(prev.body) ? prev.body : fresh;
        out.push(`- [${ticked ? "x" : " "}] ${body}`);
        if (done) out.push(`  - detected: ${done}`);
        else if (likely) out.push(`  - likely done: ${likely}`);
        else if (found) out.push(`  - found: ${found}`);
        out.push(...blocksFor((b) => b.anchor.type === "item" && b.anchor.key === key).flatMap(userLines));
        const item = items.find((it) => keyOf(it) === key);
        if (ticked) {
          doneCount++; tickedKeys.add(key);
          if (prev && !prev.ticked) newlyDone.push(item);
        }
        // A now-and-then item is never the next step: it is never done for good.
        else if (!repeat) {
          left.push(item);
          next ??= { heading: s.heading.replace(/^## /, ""), text: fresh.replace(/ \(raw: [^)]*\)/, "").replace(/ <!--.*$/, ""), item };
        }
      } else {
        out.push(l.text);
        const n = (occ.get(l.text) ?? 0) + 1; occ.set(l.text, n);
        out.push(...blocksFor((b) => b.heading === s.heading && b.anchor.type === "line" && b.anchor.text === l.text && b.anchor.n === n).flatMap(userLines));
      }
    }
    out.push(...blocksFor((b) => b.heading === s.heading && b.anchor.type !== "item").flatMap(userLines));
  }

  // Anything left: old items that no longer fit (ticked, edited or with notes), and orphan text.
  const kept = [];
  for (const [key, it] of parsed.items) {
    if (newKeys.has(key)) continue;
    const notes = blocksFor((b) => b.anchor.type === "item" && b.anchor.key === key).flatMap(userLines);
    if (it.ticked || notes.length || !staticLooksGenerated(it.body)) kept.push(it.line, ...notes);
  }
  kept.push(...blocksFor(() => true).flatMap(userLines));
  if (kept.length) out.push("", KEPT, "", KEPT_INTRO, "", ...kept);

  const meta = { answers, sources, auto: autoKeys };
  const file = `${MARK}${JSON.stringify(meta)} -->\n${mergeBlanks(out)}\n`;
  return { detect, old, answers, sources, items, plugins, keys, file, doneCount, next, left, newlyDone, tickedKeys };
}

function writeMode() {
  const { detect, old, answers, sources, items, plugins, keys, file, doneCount, next, newlyDone } = buildPlan();
  const rel = path.relative(repo, outPath) || "PLAN.md";
  if (flags["dry-run"]) process.stdout.write(file);
  else if (old?.text !== file) fs.writeFileSync(outPath, file);
  const log = flags["dry-run"] ? (t) => process.stderr.write(t + "\n") : (t) => console.log(t);

  const status = flags["dry-run"] ? "dry run, nothing written" : !old ? "written" : old.text === file ? "unchanged" : old.foreign ? "converted" : "updated";
  log(`${rel}: ${status}. ${items.length} items, ${doneCount} done.`);
  log(`Answers: ${catalog.questions.filter((q) => applies(q, answers)).map((q) => `${q.id}=${Array.isArray(answers[q.id]) ? answers[q.id].join("+") || "none" : answers[q.id]} (${sources[q.id]})`).join(", ")}`);
  log(`Install:${plugins.length ? "" : " nothing"}`);
  for (const p of plugins) log(`  /plugin install ${p}@onebox`);
  const setKeys = new Set([...(detect.config?.user?.keysSet ?? []), ...(detect.config?.project?.keysSet ?? [])]);
  const missing = keys.filter((k) => !keyIsSet(k, setKeys)).map((k) => keyLabel(k));
  log(`Config keys not set: ${missing.length ? missing.join(", ") : "none"}`);
  for (const q of catalog.questions) {
    const d = detect.answers?.[q.id];
    // An answer can agree with what detection sees: "sign in later" and a
    // detected Sign in with Apple are not a conflict.
    const agrees = !!d && q.options.find((o) => o.id === answers[q.id])?.agreesWith === d.value;
    if (sources[q.id] === "you" && d?.confidence === "high" && !agrees && JSON.stringify(normalize(q.id, d.value)) !== JSON.stringify(answers[q.id])) {
      log(`Check: you answered ${q.id}=${answers[q.id]}, but detection now says ${d.value} (${d.why}).`);
    }
  }
  for (const c of conflictsFor(answers)) log(`${c.level === "conflict" ? "Check" : "Warning"}: ${c.say}`);
  if (detect.ai?.inApp) log(`Check: the app names ${detect.ai.inApp}, so the AI key ships inside the app. Move the AI call to the server.`);
  if (newlyDone.length) log(`Newly done: ${newlyDone.map((it) => it.nudge ?? it.title).join("; ")}`);
  log(next ? `Next: ${next.text} (${next.heading})` : "Next: nothing left. Every item is ticked.");
  if (detect.cannotDetect?.length) log(`Could not detect: ${detect.cannotDetect.join("; ")}.`);
}
// An item line with no user edits: same text the planner would write.
function staticLooksGenerated(body) {
  return catalog.items.some((it) => itemText(it) === body);
}

// ---------- ready mode ----------

// Which needs a step checks: its own list, filtered by the answers.
// needs.mjs adds what each need must have first (`after`).
const stepNeeds = (it, answers) => (it.needs ?? [])
  .map((n) => (typeof n === "string" ? { id: n } : n))
  .filter((n) => matches(n.when, answers))
  .map((n) => n.id);

async function readyMode() {
  const started = Date.now();
  const NEEDS = loadNeeds();
  for (const it of catalog.items) for (const id of (it.needs ?? []).map((n) => n.id ?? n)) {
    if (!NEEDS.has(id)) die(`catalog item ${it.id} needs "${id}", which is not in needs.json`);
  }
  const extra = flags.need ? String(flags.need).split(",").map((s) => s.trim()).filter(Boolean) : [];
  for (const id of extra) if (!NEEDS.has(id)) die(`--need: "${id}" is not in needs.json. Known: ${[...NEEDS.keys()].join(", ")}`);

  const plan = buildPlan({ readonly: true });
  const stepOf = (it) => ({ id: it.id, nudge: it.nudge ?? it.title, title: it.title, link: it.kind === "guide" ? `${SITE}/guides/${slugOf(it)}/` : `/${it.plugin}:${slugOf(it)}` });

  let steps;
  if (flags.step) {
    const it = catalog.items.find((x) => x.id === flags.step);
    if (!it) die(`--step: "${flags.step}" is not a catalog item`);
    steps = [{ ...stepOf(it), ids: [...stepNeeds(it, plan.answers), ...extra] }];
  } else if (extra.length) {
    steps = [{ id: null, nudge: null, ids: extra }];
  } else if (flags.all) {
    steps = plan.left.map((it) => ({ ...stepOf(it), ids: stepNeeds(it, plan.answers) }));
  } else if (plan.next) {
    steps = [{ ...stepOf(plan.next.item), ids: stepNeeds(plan.next.item, plan.answers) }];
  } else steps = [];

  const ctx = { repo, config: loadConfig(repo), detect: plan.detect, ticked: plan.tickedKeys };
  const results = await checkNeeds(steps, NEEDS, ctx);
  const first = results[0];
  const out = flags.all
    ? { next: plan.next ? stepOf(plan.next.item) : null, steps: results.map(({ ids, ...s }) => s) }
    : { next: first?.id ? { id: first.id, nudge: first.nudge, title: first.title, link: first.link } : null, ready: !first?.blocker, blocker: first?.blocker ?? null, needs: first?.needs ?? [] };
  out.say = flags.list && first ? listFor(first) : sayFor(results, { all: !!flags.all, nothingLeft: !plan.next && !flags.step });
  out.ms = Date.now() - started;
  console.log(JSON.stringify(out, null, 2));
  process.stderr.write(out.say + "\n");
}

if (mode === "questions") questionsMode();
else if (mode === "ready") await readyMode();
else writeMode();
