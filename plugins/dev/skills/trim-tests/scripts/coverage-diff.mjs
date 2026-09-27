#!/usr/bin/env node
// Compare two coverage reports: before and after you trim tests.
//
//   node coverage-diff.mjs <before> [<after>]
//
// Each argument is a file or a folder:
//   - coverage-summary.json   Istanbul "json-summary" (Jest and Vitest)
//   - *.cobertura.xml         Cobertura (.NET coverlet, and most other tools)
//   - a folder                every coverage-summary.json or *.cobertura.xml
//                             inside it is merged (one per test project)
//
// One argument: print the totals. Two: print both totals and every file
// that lost covered lines. Exit 1 if any file lost a covered line, so a
// script can stop on it. Line coverage is the gate; branches are shown.
// Reads only. Needs Node 18+.

import fs from "node:fs";
import path from "node:path";

const [a, b] = process.argv.slice(2);
if (!a || a === "-h" || a === "--help") {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 15).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(a ? 0 : 2);
}

function findReports(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory() && e.name !== "node_modules") walk(f);
      else if (e.name === "coverage-summary.json" || e.name.endsWith(".cobertura.xml")) out.push(f);
    }
  };
  walk(p);
  return out;
}

// files: Map<file, { lines: Set<number> | null, covered, total, bCovered, bTotal }>
function load(p) {
  const files = new Map();
  const reports = findReports(p);
  if (!reports.length) throw new Error(`No coverage-summary.json or *.cobertura.xml in ${p}`);
  for (const r of reports) {
    const text = fs.readFileSync(r, "utf8");
    if (r.endsWith(".json")) {
      const j = JSON.parse(text);
      for (const [file, s] of Object.entries(j)) {
        if (file === "total") continue;
        const cur = files.get(file) ?? { covered: 0, total: 0, bCovered: 0, bTotal: 0 };
        cur.covered = Math.max(cur.covered, s.lines.covered);
        cur.total = Math.max(cur.total, s.lines.total);
        cur.bCovered = Math.max(cur.bCovered, s.branches.covered);
        cur.bTotal = Math.max(cur.bTotal, s.branches.total);
        files.set(file, cur);
      }
    } else {
      // Cobertura: <class filename="..."> ... <line number="12" hits="3" condition-coverage="50% (1/2)"/>
      const classRe = /<class\b[^>]*\bfilename="([^"]+)"[^>]*>([\s\S]*?)<\/class>/g;
      let m;
      while ((m = classRe.exec(text))) {
        const file = m[1];
        const cur = files.get(file) ?? { seen: new Map() };
        const lineRe = /<line\b([^>]*)\/?>/g;
        let l;
        while ((l = lineRe.exec(m[2]))) {
          const attr = l[1];
          const n = Number(/\bnumber="(\d+)"/.exec(attr)?.[1]);
          const hits = Number(/\bhits="(\d+)"/.exec(attr)?.[1] ?? 0);
          const cond = /condition-coverage="[^(]*\((\d+)\/(\d+)\)"/.exec(attr);
          const prev = cur.seen.get(n) ?? { hit: false, bc: 0, bt: 0 };
          prev.hit ||= hits > 0;
          if (cond) { prev.bc = Math.max(prev.bc, Number(cond[1])); prev.bt = Math.max(prev.bt, Number(cond[2])); }
          cur.seen.set(n, prev);
        }
        files.set(file, cur);
      }
    }
  }
  for (const [, f] of files) {
    if (!f.seen) continue;
    f.lines = new Set([...f.seen].filter(([, v]) => v.hit).map(([n]) => n));
    f.covered = f.lines.size;
    f.total = f.seen.size;
    f.bCovered = [...f.seen.values()].reduce((s, v) => s + v.bc, 0);
    f.bTotal = [...f.seen.values()].reduce((s, v) => s + v.bt, 0);
    delete f.seen;
  }
  return { files, reports };
}

function totals({ files }) {
  let c = 0, t = 0, bc = 0, bt = 0;
  for (const f of files.values()) { c += f.covered; t += f.total; bc += f.bCovered; bt += f.bTotal; }
  const pct = (x, y) => (y ? ((100 * x) / y).toFixed(2) : "n/a");
  return { c, t, bc, bt, line: pct(c, t), branch: pct(bc, bt) };
}
const show = (label, r) => {
  const t = totals(r);
  console.log(`${label.padEnd(7)} lines ${t.line}% (${t.c}/${t.t})  branches ${t.branch}% (${t.bc}/${t.bt})  from ${r.reports.length} report(s)`);
  return t;
};

const before = load(a);
const tb = show("before", before);
if (!b) process.exit(0);
const after = load(b);
const ta = show("after", after);
console.log(`change  lines ${(ta.line - tb.line).toFixed(2)} pts, branches ${ta.branch === "n/a" || tb.branch === "n/a" ? "n/a" : (ta.branch - tb.branch).toFixed(2) + " pts"}`);

const lost = [];
for (const [file, f0] of before.files) {
  const f1 = after.files.get(file) ?? { covered: 0, lines: new Set() };
  if (f0.lines && f1.lines) {
    const gone = [...f0.lines].filter((n) => !f1.lines.has(n)).sort((x, y) => x - y);
    if (gone.length) lost.push({ file, n: gone.length, detail: `lines ${ranges(gone)}` });
  } else if (f1.covered < f0.covered) {
    lost.push({ file, n: f0.covered - f1.covered, detail: `${f0.covered} -> ${f1.covered} covered lines` });
  }
}
function ranges(ns) {
  const out = [];
  for (let i = 0; i < ns.length; i++) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    out.push(i === j ? `${ns[i]}` : `${ns[i]}-${ns[j]}`);
    i = j;
  }
  return out.slice(0, 12).join(", ") + (out.length > 12 ? ", ..." : "");
}

if (!lost.length) {
  console.log("\nNo file lost a covered line.");
  process.exit(0);
}
lost.sort((x, y) => y.n - x.n);
console.log(`\n${lost.length} file(s) lost covered lines. Put back a test for each, or say why the lines no longer matter:`);
for (const l of lost) console.log(`  -${String(l.n).padStart(4)}  ${l.file}  (${l.detail})`);
process.exit(1);
