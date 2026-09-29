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

// ---------- running a command ----------

function run(cmd, { cwd, env = {}, timeout = TIMEOUT, stdout = false, stderr = false }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("/bin/sh", ["-c", cmd], {
        cwd,
        detached: true, // its own process group, so a timeout kills what it started too
        stdio: ["ignore", stdout ? "pipe" : "ignore", stderr ? "pipe" : "ignore"],
        env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0", NO_COLOR: "1", ...env },
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
  const tool = get(ctx.config, "secrets.tool") ?? "env";
  if (tool === "1password") return { status: "unknown", why: "cannot check 1Password secrets without a prompt; confirm by hand" };
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { status: "unknown", why: "the secret reference is not a plain name" };
  if (tool === "env") {
    if (process.env[name]) return { status: "ok" };
    // The nearest .env, walking up from the repo (CONFIG.md).
    for (let d = ctx.repo; ; d = path.dirname(d)) {
      const f = path.join(d, ".env");
      if (fs.existsSync(f)) {
        let text = "";
        try { text = fs.readFileSync(f, "utf8"); } catch { return { status: "unknown", why: "cannot read the nearest .env" }; }
        const m = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`, "m").exec(text);
        const has = !!m && m[1].trim().replace(/^(["'])(.*)\1$/, "$2").trim() !== "";
        return has ? { status: "ok" } : { status: "missing", why: "not in the environment or the nearest .env" };
      }
      if (path.dirname(d) === d) return { status: "missing", why: "not in the environment, and no .env file" };
    }
  }
  if (tool === "doppler") {
    const P = get(ctx.config, "secrets.doppler.project"), C = get(ctx.config, "secrets.doppler.config");
    if (!P || !C) return { status: "unknown", why: "no Doppler project and config in the onebox config" };
    // stdout is /dev/null twice over: the value never reaches this process.
    const r = await run('doppler secrets get "$N" --plain -p "$P" -c "$C" >/dev/null', { cwd: ctx.repo, env: { N: name, P: String(P), C: String(C) }, timeout: 8, stderr: true });
    if (r.code === 0) return { status: "ok" };
    if (r.timedOut) return { status: "unknown", why: "Doppler did not answer in 8 s" };
    if (r.code != null && /could not find|not found|does not exist/i.test(r.err ?? "")) return { status: "missing", why: "not in Doppler" };
    return { status: "unknown", why: "Doppler could not be asked (not installed, not signed in, or offline)" };
  }
  return { status: "unknown", why: `unknown secrets.tool "${tool}"` };
}

async function secretsCli(ctx) {
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
    const r = await run(c.run, { cwd: ctx.repo, env, timeout: t, stdout: !!c.version });
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
