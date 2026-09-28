#!/usr/bin/env node
// Plugin versions. Claude Code updates an installed plugin only when its
// version changes, so every change under plugins/<plugin>/ needs a new version.
//
//   node scripts/versions.mjs check [--base origin/main]
//       Fails when a plugin changed since the base and its version did not go
//       up, or when plugin.json and marketplace.json disagree.
//   node scripts/versions.mjs bump <plugin> [patch|minor]
//       Raises the version in both files. patch (the default) for a fix,
//       minor for a new skill.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MARKET = ".claude-plugin/marketplace.json";
const pluginFile = (p) => `plugins/${p}/.claude-plugin/plugin.json`;

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const replaceIn = (file, re, version) => {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  if (!re.test(text)) throw new Error(`no version found in ${file}`);
  fs.writeFileSync(path.join(root, file), text.replace(re, `$1${version}`));
};
const parse = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v ?? "");
  if (!m) throw new Error(`not a version: ${v}`);
  return m.slice(1).map(Number);
};
const newer = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

function check(base) {
  const errors = [];
  const market = readJson(MARKET);
  for (const entry of market.plugins) {
    const own = readJson(pluginFile(entry.name)).version;
    if (own !== entry.version) {
      errors.push(`${entry.name}: plugin.json says ${own}, marketplace.json says ${entry.version}`);
    }
  }

  const since = git("merge-base", "HEAD", base);
  const changed = new Set(
    git("diff", "--name-only", since, "--", "plugins/")
      .split("\n")
      .filter(Boolean)
      .map((f) => f.split("/")[1]),
  );
  for (const p of changed) {
    let before;
    try {
      before = JSON.parse(git("show", `${since}:${pluginFile(p)}`)).version;
    } catch {
      continue; // a new plugin: any version is new
    }
    const now = readJson(pluginFile(p)).version;
    if (!newer(now, before)) {
      errors.push(`${p}: files changed since ${base}, but the version is still ${now}. Run: node scripts/versions.mjs bump ${p}`);
    }
  }

  if (errors.length) {
    for (const e of errors) console.error(e);
    process.exit(1);
  }
  console.log(changed.size ? `versions ok: ${[...changed].join(", ")} raised` : "versions ok: no plugin changed");
}

function bump(p, level = "patch") {
  if (!p || !fs.existsSync(path.join(root, pluginFile(p)))) throw new Error(`no plugin named ${p}`);
  if (!["patch", "minor"].includes(level)) throw new Error("level is patch or minor");
  const [ma, mi, pa] = parse(readJson(pluginFile(p)).version);
  const next = level === "minor" ? `${ma}.${mi + 1}.0` : `${ma}.${mi}.${pa + 1}`;
  // Replace the text, not the JSON, so each file keeps its own formatting.
  replaceIn(pluginFile(p), /("version":\s*")[^"]+/, next);
  replaceIn(MARKET, new RegExp(`("name":\\s*"${p}"[^}]*?"version":\\s*")[^"]+`), next);
  console.log(`${p}: ${next}`);
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === "check") {
    const i = rest.indexOf("--base");
    check(i >= 0 ? rest[i + 1] : "origin/main");
  } else if (cmd === "bump") {
    bump(rest[0], rest[1]);
  } else {
    console.error("usage: versions.mjs check [--base <ref>] | bump <plugin> [patch|minor]");
    process.exit(2);
  }
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
