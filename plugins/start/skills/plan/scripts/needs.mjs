// Check what a plan step needs, from references/needs.json. Used by
// `plan.mjs ready`.
//
// Read-only. Every check is non-interactive: stdin is closed, and each command
// runs in its own process group, which is killed after its timeout. A check
// that cannot run, or that times out, gives `unknown`, never `missing`.
// Secrets: only whether one exists. A value never reaches this process's
// output: a secret command's stdout goes to /dev/null, and the 1Password CLI
// is never called, because it can show a prompt and hang an agent.
// Node 18+, no dependencies.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dotenvValue, secretCommand } from "./secret.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TIMEOUT = 5; // seconds, when a check names none
const BLOCKS = new Set(["missing", "old", "yours"]);

export function loadNeeds() {
  const doc = JSON.parse(fs.readFileSync(path.join(HERE, "..", "references", "needs.json"), "utf8"));
  const needs = new Map(doc.needs.map((n) => [n.id, n]));
  // `after` must name known needs, with no loop: a loop would wait forever.
  const visit = (id, trail) => {
    if (trail.includes(id)) throw new Error(`needs.json: "after" loops: ${[...trail, id].join(" -> ")}`);
    for (const a of needs.get(id).after ?? []) {
      if (!needs.has(a)) throw new Error(`needs.json: ${id} has after "${a}", which is not a need`);
      visit(a, [...trail, id]);
    }
  };
  for (const id of needs.keys()) visit(id, []);
  return needs;
}

// ---------- config ----------

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const merge = (a, b) => {
  const o = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) o[k] = isObj(v) && isObj(o[k]) ? merge(o[k], v) : v;
  return o;
};
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

// The onebox config, project over user (CONFIG.md). Values stay in memory.
export function loadConfig(repo) {
  return merge(readJson(path.join(os.homedir(), ".config", "onebox", "config.json")) ?? {}, readJson(path.join(repo, ".onebox.json")) ?? {});
}
const get = (cfg, key) => {
  const v = key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), cfg);
  return v === "" || v == null ? undefined : v;
};

// ---------- the user's own Terminal ----------

// The app that runs this script often has a longer PATH than the user's
// Terminal: some add /opt/homebrew/bin whether or not the user has it. A tool
// found only there is missing where the user types, and a step that says "run
// this in your own terminal" fails. So the checks run with the PATH a login
// shell gives, like Terminal.app: only the user's startup files, no
// inherited PATH. It is read once. If it cannot be read, the checks use this
// process's PATH, as before.
let terminal; // a promise of { path }: the checks run in parallel
const terminalEnv = () => (terminal ??= readTerminal());
async function readTerminal() {
  const term = { path: undefined };
  const home = os.homedir();
  const shell = ["/bin/zsh", "/bin/bash"].includes(process.env.SHELL) ? process.env.SHELL : "/bin/zsh";
  if (process.platform !== "darwin" || !fs.existsSync(shell)) return term;
  const clean = `env -i HOME="${home}" USER="${os.userInfo().username}" SHELL=${shell} TERM=xterm-256color ${shell} -lic`;
  // Markers, because a startup file may print something.
  const r = await run(`${clean} 'printf "\n@@P@@%s@@P@@\n" "$PATH"' 2>/dev/null`, { cwd: home, timeout: 8, stdout: true, raw: true });
  const m = /@@P@@(.*?)@@P@@/.exec(r.out ?? "");
  if (m && m[1].includes("/usr/bin")) term.path = m[1];
  return term;
}

// ---------- running a command ----------

function run(cmd, { cwd, env = {}, timeout = TIMEOUT, stdout = false, stderr = false, raw = false }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("/bin/sh", ["-c", cmd], {
        cwd,
        detached: true, // its own process group, so a timeout kills what it started too
        stdio: ["ignore", stdout ? "pipe" : "ignore", stderr ? "pipe" : "ignore"],
        env: { ...process.env, ...(raw ? {} : { COREPACK_ENABLE_DOWNLOAD_PROMPT: "0", NO_COLOR: "1" }), ...env },
      });
    } catch (e) { resolve({ error: e.message }); return; }
    let out = "", err = "", done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    child.stdout?.on("data", (d) => { if (out.length < 65536) out += d; });
    child.stderr?.on("data", (d) => { if (err.length < 65536) err += d; });
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
      finish({ timedOut: true });
    }, timeout * 1000);
    child.on("error", (e) => finish({ error: e.message }));
    child.on("close", (code) => finish({ code, out, err }));
  });
}

const firstVersion = (s) => s.match(/\d+(?:\.\d+)*/)?.[0];
const cmpVersion = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
};

// ---------- secrets: existence only ----------

async function secretExists(name, ctx) {
  // The same order the scripts read in (secret.mjs, CONFIG.md "Secrets").
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && process.env[name]) return { status: "ok" };
  const command = secretCommand(ctx.config, name);
  if (command) {
    const tool = get(ctx.config, "secrets.tool");
    if (!get(ctx.config, "secrets.command") && tool === "1password")
      return { status: "unknown", why: "cannot check 1Password secrets without a prompt; confirm by hand" };
    // stdout goes to /dev/null: the value never reaches this process.
    const r = await run(`( ${command} ) >/dev/null`, { cwd: ctx.repo, timeout: 8, stderr: true });
    if (r.code === 0) return { status: "ok" };
    if (r.timedOut) return { status: "unknown", why: "your secrets command did not answer in 8 s" };
    if (tool === "doppler" && !get(ctx.config, "secrets.command")) {
      if (r.code != null && /could not find|not found|does not exist/i.test(r.err ?? "")) return { status: "missing", why: "not in Doppler" };
      return { status: "unknown", why: "Doppler could not be asked (not installed, not signed in, or offline)" };
    }
    return { status: "missing", why: "your secrets command could not read it (missing, or not signed in)" };
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { status: "unknown", why: "the secret reference is not a plain name" };
  let found = null;
  try { found = dotenvValue(name, ctx.repo); } catch { return { status: "unknown", why: "cannot read the nearest .env" }; }
  return found ? { status: "ok" } : { status: "missing", why: "not in the environment, your secrets command or a .env file" };
}

async function secretsCli(ctx) {
  const custom = get(ctx.config, "secrets.command");
  if (custom) {
    const bin = String(custom).trim().split(/\s+/)[0];
    const r = await run('command -v "$B" >/dev/null 2>&1', { cwd: ctx.repo, env: { B: bin } });
    return r.code === 0 ? { status: "ok" } : { status: "missing", why: `${bin}, from secrets.command, is not installed` };
  }
  const tool = get(ctx.config, "secrets.tool") ?? "env";
  if (tool === "env") return { status: "ok" };
  if (tool === "1password") {
    // Only whether `op` is there. Never run it: it can prompt.
    const r = await run("command -v op >/dev/null 2>&1", { cwd: ctx.repo });
    return r.code === 0 ? { status: "ok" } : { status: "missing", why: "the 1Password CLI (op) is not installed" };
  }
  if (tool === "doppler") {
    const have = await run("command -v doppler >/dev/null 2>&1", { cwd: ctx.repo });
    if (have.code !== 0) return { status: "missing", why: "the Doppler CLI is not installed" };
    const r = await run("doppler me --json >/dev/null", { cwd: ctx.repo, timeout: 6, stderr: true });
    if (r.code === 0) return { status: "ok" };
    if (r.code != null && /log ?in|token|unauthori[sz]ed|authenticat/i.test(r.err ?? "")) return { status: "missing", why: "not signed in to Doppler" };
    return { status: "unknown", why: "Doppler could not be asked (offline?)" };
  }
  return { status: "unknown", why: `unknown secrets.tool "${tool}"` };
}

// ---------- one check ----------

async function evaluate(c, ctx) {
  if (c.any) {
    const rs = await Promise.all(c.any.map((x) => evaluate(x, ctx)));
    // A hand check beats "missing": the user can still confirm it.
    for (const s of ["ok", "skip", "manual", "unknown", "old", "missing"]) { const r = rs.find((x) => x.status === s); if (r) return r; }
  }
  if (c.all) {
    const rs = await Promise.all(c.all.map((x) => evaluate(x, ctx)));
    for (const s of ["missing", "old", "manual", "unknown"]) { const r = rs.find((x) => x.status === s); if (r) return r; }
    return { status: "ok" };
  }
  if (c.run) {
    const env = {};
    for (const [k, key] of Object.entries(c.env ?? {})) {
      const v = get(ctx.config, key);
      if (v === undefined) return { status: "missing", why: `${key} is not set` };
      env[k] = String(v);
    }
    const t = c.timeout ?? TIMEOUT;
    const term = await terminalEnv();
    if (term.path) env.PATH = term.path;
    let r = await run(c.run, { cwd: ctx.repo, env, timeout: t, stdout: !!c.version });
    if (term.path && r.code === 127) {
      // Not found where the user types. Is it found where this app runs?
      const { PATH: _, ...rest } = env;
      const again = await run(c.run, { cwd: ctx.repo, env: rest, timeout: t });
      if (again.code === 0) return { status: "missing", why: "found for this app, but not in your own terminal", appOnly: true };
    }
    if (r.timedOut) return { status: "unknown", why: `the check took longer than ${t} s` };
    if (r.code == null) return { status: "unknown", why: r.error ?? "the check was stopped" };
    if (r.code === 3) return { status: "unknown", why: "the check cannot run here" };
    if (r.code !== 0) return { status: "missing", why: r.code === 127 ? "command not found" : `exit code ${r.code}` };
    if (!c.version) return { status: "ok" };
    const have = firstVersion(r.out ?? "");
    if (!have) return { status: "unknown", why: "no version number in the output" };
    if (c.version.min && cmpVersion(have, c.version.min) < 0) return { status: "old", have, want: `${c.version.min} or newer` };
    if (c.version.major != null && Number(have.split(".")[0]) !== c.version.major) return { status: "old", have, want: String(c.version.major) };
    return { status: "ok", have };
  }
  if (c.config) {
    const miss = c.config.filter((k) => get(ctx.config, k) === undefined);
    return miss.length ? { status: "missing", why: `not set: ${miss.join(", ")}` } : { status: "ok" };
  }
  if (c.file) {
    const v = get(ctx.config, c.file);
    if (v === undefined) return { status: "missing", why: `${c.file} is not set` };
    const p = String(v).replace(/^~(?=\/|$)/, os.homedir());
    return fs.existsSync(p) ? { status: "ok" } : { status: "missing", why: `the file in ${c.file} is not there` };
  }
  if (c.secret) {
    const refs = [c.secret.ref].flat().filter(Boolean);
    const name = refs.map((k) => get(ctx.config, k)).find((v) => v !== undefined) ?? c.secret.default;
    return secretExists(String(name), ctx);
  }
  if (c.secretsCli) return secretsCli(ctx);
  if (c.secretsConfig) {
    if ((get(ctx.config, "secrets.tool") ?? "env") !== "doppler") return { status: "ok" };
    const miss = ["secrets.doppler.project", "secrets.doppler.config"].filter((k) => get(ctx.config, k) === undefined);
    return miss.length ? { status: "missing", why: `not set: ${miss.join(", ")}` } : { status: "ok" };
  }
  if (c.plugin) {
    const f = path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");
    if (!fs.existsSync(f)) return { status: "skip", why: "no Claude Code plugin list on this machine" };
    const j = readJson(f);
    if (!j) return { status: "unknown", why: "cannot read Claude Code's plugin list" };
    return Object.keys(j.plugins ?? {}).includes(`${c.plugin}@onebox`) ? { status: "ok" } : { status: "missing", why: `${c.plugin}@onebox is not installed` };
  }
  if (c.planItem) {
    const k = c.planItem;
    return ctx.detect?.done?.[k] || ctx.detect?.seen?.[k] || ctx.ticked?.has(k) ? { status: "ok" } : { status: "missing", why: `the plan does not show ${k} as done` };
  }
  if (c.detect) {
    const v = c.detect.split(".").reduce((o, k) => (o == null ? undefined : o[k]), ctx.detect);
    return v === true ? { status: "ok" } : { status: "missing", why: `detect.mjs: ${c.detect} is not true` };
  }
  if (c.manual) return { status: "manual", why: c.manual };
  return { status: "unknown", why: "needs.json: a check this script does not know" };
}

// ---------- steps ----------

const lcFirst = (s) => (/^(The|A|An|Your)\b/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
function problemOf(n, r) {
  const l = lcFirst(n.label);
  if (r.status === "old") return r.want.endsWith("or newer") ? `${l} needs an update (to ${r.want})` : `${l} must be version ${r.want}, not ${r.have}`;
  if (n.problem) return n.problem;
  return {
    tool: `${l} is not installed`,
    login: `you are not signed in to ${l}`,
    secret: `${l} is not in your secrets yet`,
    account: `you do not have ${l} yet`,
    config: `${l} is not set up yet`,
  }[n.kind] ?? `${l} is missing`;
}

// steps: [{ id, nudge, ..., ids: [need ids] }]. Returns the same steps with
// `needs` (each need's result, in check order) and `blocker` (the first need
// that stops the step, or null). Each need runs once, however many steps use it.
export async function checkNeeds(steps, NEEDS, ctx) {
  const memo = new Map();
  const check = (id) => {
    if (!memo.has(id)) memo.set(id, (async () => {
      const n = NEEDS.get(id);
      for (const a of n.after ?? []) {
        const d = await check(a);
        if (!["ok", "skip"].includes(d.status)) return { status: "unknown", why: `needs ${lcFirst(NEEDS.get(a).label)} first` };
      }
      const r = await evaluate(n.check, ctx);
      return r.status === "manual" ? { status: n.yours ? "yours" : "unknown", why: r.why } : r;
    })());
    return memo.get(id);
  };
  const expand = (ids) => {
    const out = [];
    const add = (id) => { if (out.includes(id)) return; for (const a of NEEDS.get(id).after ?? []) add(a); out.push(id); };
    ids.forEach(add);
    return out;
  };
  return Promise.all(steps.map(async (s) => {
    const ids = expand(s.ids);
    const needs = await Promise.all(ids.map(async (id) => {
      const n = NEEDS.get(id), r = await check(id);
      const x = { id, label: n.label, kind: n.kind, status: r.status };
      for (const k of ["why", "have", "want"]) if (r[k]) x[k] = r[k];
      if (r.appOnly) x.appOnly = true;
      if (BLOCKS.has(r.status) || (r.status === "unknown" && r.why?.startsWith("needs "))) {
        // A need that waits for another (eas after node) is listed with its fix,
        // so the whole list is known up front.
        x.problem = problemOf(n, r.status === "unknown" ? { status: "missing" } : r);
        x.fix = n.fix;
        x.safe = !!n.safe && !n.yours;
        x.yours = !!n.yours;
        x.waits = r.status === "unknown";
        if (n.takes) x.takes = n.takes;
      }
      if (BLOCKS.has(r.status)) {
        x.problem = problemOf(n, r);
        x.fix = n.fix;
        if (n.hint) x.hint = n.hint;
        if (n.ask) x.ask = n.ask;
        if (n.guide) x.guide = n.guide;
        x.yours = !!n.yours;
        x.safe = !!n.safe && !n.yours;
      }
      return x;
    }));
    return { ...s, needs, blocker: needs.find((x) => BLOCKS.has(x.status)) ?? null };
  }));
}

// ---------- what the agent says ----------

function lineFor(s) {
  const pre = s.nudge ? `Next: ${s.nudge}. ` : "";
  const b = s.blocker;
  if (!b) return s.nudge ? `${pre}Continue?` : "Everything is ready.";
  const hint = b.hint ? ` (${b.hint})` : "";
  if (b.status === "yours") return `${pre}This part is yours: ${b.fix}${hint}. Ready when you are.`;
  if (b.yours) return `${pre}One thing first: ${b.problem}. This part is yours: ${b.fix}${hint}. Ready when you are.`;
  if (b.ask) return `${pre}One thing first: ${b.problem}. ${b.ask}`;
  if (b.safe) return `${pre}One thing first: ${b.problem} (${b.fix}). Should I run it, then continue?`;
  return `${pre}One thing first: ${b.problem}. To fix it: ${b.fix}. Tell me when it is done.`;
}

// One list of everything a step still needs, then one question. For the first
// step (new-app): the user sees what is missing, why, and how long it takes
// before anything is installed, not one blocker at a time.
export function listFor(s) {
  const bad = s.needs.filter((n) => BLOCKS.has(n.status) || n.waits);
  if (!bad.length) return s.nudge ? `Next: ${s.nudge}. Everything this step needs is here. Continue?` : "Everything is ready.";
  const mine = bad.filter((n) => n.safe && !n.ask), yours = bad.filter((n) => !mine.includes(n));
  const lines = [`${s.nudge ? `Next: ${s.nudge}. ` : ""}First, ${bad.length === 1 ? "one thing is" : `${bad.length} things are`} missing on this Mac. I checked with your own Terminal, not only this app.`, ""];
  let i = 0;
  const one = (n, how) => {
    const why = n.appOnly ? " (this app finds it, your Terminal does not)" : "";
    const took = n.takes ? ` Takes ${n.takes}.` : "";
    lines.push(`${++i}. ${n.problem.replace(/^you\b/, "You").replace(/^./, (c) => (/^(pnpm|eas)\b/.test(n.problem) ? c : c.toUpperCase()))}${why}. ${how}${how.endsWith(".") ? "" : "."}${took}`);
  };
  for (const n of mine) one(n, `I can install it with \`${n.fix}\``);
  for (const n of yours) one(n, n.ask ? n.ask : `This part is yours: ${n.fix}`);
  lines.push("");
  if (mine.length && yours.length) lines.push(`Should I install ${mine.length === 1 ? "the first one" : `the first ${mine.length}`} now, one by one? The rest are yours; I will tell you when each is due.`);
  else if (mine.length) lines.push(`Should I install ${mine.length === 1 ? "it" : "them"} now, one by one, then continue?`);
  else lines.push("These are yours to do. Tell me when each is done.");
  return lines.join("\n");
}

export function sayFor(results, { all = false, nothingLeft = false } = {}) {
  if (!results.length) return nothingLeft ? "Every step in the plan is ticked. Nothing is left." : "Nothing to check.";
  if (!all) return lineFor(results[0]);
  // --all: one line per step that needs something, each need named once.
  const lines = [`Next: ${results[0].nudge}.`];
  const said = new Set(), unknown = new Map();
  const item = (n) => (n.status === "yours" ? `${n.fix} (yours)`
    : n.yours ? `${n.problem}: ${n.fix} (yours)`
    : n.ask ? `${n.problem}: ${n.ask}`
    : n.safe ? `${n.problem} (${n.fix})`
    : `${n.problem}: ${n.fix}`);
  for (const s of results) {
    const probs = s.needs.filter((n) => BLOCKS.has(n.status) && !said.has(n.id));
    probs.forEach((n) => said.add(n.id));
    for (const n of s.needs) if (n.status === "unknown" && !n.why?.startsWith("needs ")) unknown.set(n.id, n);
    const text = probs.map(item).join("; ");
    if (probs.length) lines.push(`- ${s.nudge}: ${text}${/[.?]$/.test(text) ? "" : "."}`);
  }
  if (lines.length === 1) lines.push("Nothing is missing for the steps left.");
  if (unknown.size) lines.push(`Could not check: ${[...unknown.values()].map((n) => `${lcFirst(n.label)} (${n.why})`).join("; ")}.`);
  return lines.join("\n");
}
