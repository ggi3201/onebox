#!/usr/bin/env node
// Find the commands this repo already has for each step of the test loop.
//
//   node discover.mjs [<repo-root>]
//
// Prints, per package.json and per .NET solution: the lint, typecheck, test,
// seed and run commands; the TypeScript strict flags; whether ESLint, a test
// runner, Testcontainers and coverage are set up; and the flow files.
// It suggests a command only when the repo has none, and marks it "(suggested)".
// Reads only. Needs Node 18+.

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const SKIP = new Set(["node_modules", ".git", "bin", "obj", "ios", "android", "dist", "build", ".expo", ".next", "Pods", "worktrees", "coverage", "TestResults"]);

function walk(dir, depth, hit) {
  if (depth < 0) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith(".")) walk(f, depth - 1, hit); }
    else hit(f, e.name);
  }
}
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
// tsconfig.json allows comments and trailing commas. Strip them outside strings.
const readJsonc = (p) => {
  try {
    const t = fs.readFileSync(p, "utf8");
    let out = "", i = 0, str = false;
    while (i < t.length) {
      const c = t[i], n = t[i + 1];
      if (str) { out += c; if (c === "\\") { out += n ?? ""; i += 2; continue; } if (c === '"') str = false; i++; continue; }
      if (c === '"') { str = true; out += c; i++; continue; }
      if (c === "/" && n === "/") { while (i < t.length && t[i] !== "\n") i++; continue; }
      if (c === "/" && n === "*") { i = t.indexOf("*/", i + 2); i = i < 0 ? t.length : i + 2; continue; }
      out += c; i++;
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
  } catch { return null; }
};
const rel = (p) => path.relative(root, p) || ".";

const pkgs = [], slns = [], csprojs = [], flows = [];
// Deep enough for apps/mobile/src/features/<f>/<f>.flow.md. The heavy
// folders are skipped, so depth costs little.
walk(root, 10, (f, n) => {
  if (n === "package.json") pkgs.push(f);
  else if (n.endsWith(".sln") || n.endsWith(".slnx")) slns.push(f);
  else if (n.endsWith(".csproj")) csprojs.push(f);
  else if (n.endsWith(".flow.md")) flows.push(f);
});

const pm = fs.existsSync(path.join(root, "pnpm-lock.yaml")) ? "pnpm"
  : fs.existsSync(path.join(root, "bun.lock")) || fs.existsSync(path.join(root, "bun.lockb")) ? "bun"
  : fs.existsSync(path.join(root, "yarn.lock")) ? "yarn" : "npm";
const run = (dir, script) => {
  if (dir === root) return `${pm} run ${script}`;
  const d = rel(dir);
  return { pnpm: `pnpm --dir ${d} run ${script}`, npm: `npm --prefix ${d} run ${script}`, yarn: `yarn --cwd ${d} ${script}`, bun: `bun --cwd ${d} run ${script}` }[pm];
};

console.log(`Repo ${root}`);
console.log(`Package manager: ${pm}`);
for (const f of ["AGENTS.md", "CLAUDE.md", ".claude/CLAUDE.md"]) if (fs.existsSync(path.join(root, f))) console.log(`Agent rules: ${f}`);

const WANT = /^(lint|lint:.*|typecheck|type-check|tsc|check|test|test:.*|format|fmt|e2e|seed|db:.*|dev|dev:.*|start|ios)$/;
for (const p of pkgs.sort()) {
  const dir = path.dirname(p);
  const j = readJson(p);
  if (!j) continue;
  const deps = { ...(j.dependencies || {}), ...(j.devDependencies || {}) };
  const isExpo = !!deps.expo;
  const scripts = Object.entries(j.scripts || {}).filter(([k]) => WANT.test(k));
  if (!scripts.length && !isExpo && dir !== root) continue;
  console.log(`\n${rel(dir)}${isExpo ? "  (Expo app)" : ""}${j.name ? `  [${j.name}]` : ""}`);
  for (const [k, v] of scripts) console.log(`  ${k.padEnd(12)} ${run(dir, k).padEnd(34)} # ${String(v).slice(0, 90)}`);

  const has = (k) => scripts.some(([s]) => s === k || s.startsWith(`${k}:`));
  const eslintCfg = ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts", ".eslintrc.js", ".eslintrc.json", ".eslintrc"].find((f) => fs.existsSync(path.join(dir, f)));
  const tsconfig = path.join(dir, "tsconfig.json");
  const vitestCfg = fs.readdirSync(dir).find((f) => /^vitest\.config\./.test(f));
  const jestCfg = fs.readdirSync(dir).find((f) => /^jest\.config\./.test(f)) || (j.jest ? "package.json#jest" : null);

  if (fs.existsSync(tsconfig)) {
    const co = readJsonc(tsconfig)?.compilerOptions || {};
    const flags = ["strict", "noUncheckedIndexedAccess", "exactOptionalPropertyTypes", "noImplicitOverride", "noFallthroughCasesInSwitch", "noImplicitReturns"];
    console.log(`  tsconfig     ${flags.map((f) => `${f}=${co[f] ?? "-"}`).join(" ")}`);
    if (!has("typecheck") && !has("tsc") && !has("check")) console.log(`  typecheck    npx tsc --noEmit -p ${rel(tsconfig)}   (suggested)`);
  }
  console.log(`  eslint       ${eslintCfg ?? "none"}${eslintCfg && !has("lint") ? `  -> npx eslint ${rel(dir)} (suggested)` : ""}${!eslintCfg && isExpo ? "  -> npx expo lint sets it up (it edits package.json)" : ""}`);
  const runner = vitestCfg ? `vitest (${vitestCfg})` : jestCfg ? `jest (${jestCfg})` : deps.vitest ? "vitest" : deps.jest ? "jest" : "none";
  const cov = deps["@vitest/coverage-v8"] || deps["@vitest/coverage-istanbul"] ? "coverage provider installed" : deps.jest ? "coverage built in" : "no coverage provider";
  console.log(`  tests        ${runner}${runner === "none" ? "" : `, ${cov}`}`);
  if (isExpo) console.log(`  bundle check npx expo export --platform ios --output-dir <tmp dir>   (catches Metro build errors without a device)`);
}

for (const s of slns.sort()) {
  console.log(`\n${rel(s)}  (.NET)`);
  console.log(`  build        dotnet build ${rel(s)} -warnaserror`);
  console.log(`  test         dotnet test ${rel(s)}`);
}
// MSBuild walks up from each project's folder and imports the first
// Directory.Build.props it finds. Stop at the repo root.
const propsFor = (csproj) => {
  for (let d = path.dirname(csproj); ; d = path.dirname(d)) {
    const f = path.join(d, "Directory.Build.props");
    if (fs.existsSync(f)) return f;
    if (d === root || path.dirname(d) === d) return null;
  }
};
// The last value wins, and the project file comes after Directory.Build.props.
const prop = (xml, name) => [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>\\s*([^<\\s]+)\\s*</${name}>`, "gi"))].pop()?.[1];
const usedProps = new Set();
for (const c of csprojs.sort()) {
  const x = fs.readFileSync(c, "utf8");
  const propsFile = propsFor(c);
  if (propsFile) usedProps.add(propsFile);
  const px = propsFile ? fs.readFileSync(propsFile, "utf8") : "";
  const isTest = /Microsoft\.NET\.Test\.Sdk|IsTestProject>true/i.test(x);
  const nullable = prop(x, "Nullable") ?? prop(px, "Nullable") ?? "-";
  const warnErr = prop(x, "TreatWarningsAsErrors") ?? prop(px, "TreatWarningsAsErrors") ?? "-";
  if (isTest) {
    const pk = (n) => new RegExp(`Include="${n}`, "i").test(x);
    const db = pk("Testcontainers") ? "Testcontainers" : pk("Microsoft.EntityFrameworkCore.InMemory") ? "EF InMemory (not a real database)" : pk("Npgsql") ? "Npgsql (needs a database)" : "no database package";
    console.log(`  test project ${rel(c)}: ${pk("xunit") ? "xUnit" : pk("NUnit") ? "NUnit" : pk("MSTest") ? "MSTest" : "?"}, ${db}, ${pk("coverlet.collector") ? "coverlet" : "no coverlet"}`);
  } else {
    console.log(`  project      ${rel(c)}: Nullable=${nullable} TreatWarningsAsErrors=${warnErr}${propsFile ? ` (with ${rel(propsFile)})` : ""}`);
  }
}
if (slns.length) console.log(`  Directory.Build.props: ${usedProps.size ? [...usedProps].map(rel).join(", ") : "none"}`);

console.log(`\nFlows: ${flows.length ? flows.map(rel).join(", ") : "none yet"}`);
const maestro = pkgs.map(path.dirname).filter((d) => fs.existsSync(path.join(d, ".maestro")));
if (maestro.length) console.log(`Maestro: ${maestro.map((d) => rel(path.join(d, ".maestro"))).join(", ")}`);
