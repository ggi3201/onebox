#!/usr/bin/env node
// Plugin versions. Claude Code updates an installed plugin only when its
// version changes, so every change under plugins/<plugin>/ needs a new version.
//
//   node scripts/versions.mjs check [--base origin/main]
//       Fails when a plugin changed since the base and its version did not go
//       up, when a new version has no entry in CHANGELOG.md, or when
//       plugin.json and marketplace.json disagree.
//   node scripts/versions.mjs bump <plugin> [patch|minor]
//       Raises the version in both files, and adds an empty entry for it to
//       CHANGELOG.md. patch (the default) for a fix, minor for a new skill.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MARKET = ".claude-plugin/marketplace.json";
const CHANGELOG = "CHANGELOG.md";
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

// CHANGELOG.md has a "## <plugin>" section per plugin, and in it a
// "### <version> (<date>)" heading per version, newest first.
const changelogLines = () => {
  const file = path.join(root, CHANGELOG);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n") : [];
};
const sectionOf = (lines, p) => {
  const start = lines.findIndex((l) => l.trim() === `## ${p}`);
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return { start, end };
};
const isEntry = (line, version) => line.startsWith(`### ${version} `) || line.trim() === `### ${version}`;
// What is missing for this version: null when the entry is there and has a
// bullet with text in it. "- " alone, as bump writes it, does not count.
const changelogGap = (p, version) => {
  const lines = changelogLines();
  const s = sectionOf(lines, p);
  const at = s ? lines.findIndex((l, i) => i > s.start && i < s.end && isEntry(l, version)) : -1;
  if (at < 0) return "no entry";
  for (let i = at + 1; i < s.end && !/^#{2,3} /.test(lines[i]); i++) {
    if (/^[-*] +\S/.test(lines[i])) return null;
  }
  return "an empty entry";
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
    let before = null; // a new plugin: any version is new
    try {
      before = JSON.parse(git("show", `${since}:${pluginFile(p)}`)).version;
    } catch {}
    const now = readJson(pluginFile(p)).version;
    if (before && !newer(now, before)) {
      errors.push(`${p}: files changed since ${base}, but the version is still ${now}. Run: node scripts/versions.mjs bump ${p}`);
      continue;
    }
    const gap = changelogGap(p, now);
    if (gap === "no entry") {
      errors.push(`${p}: the version went up to ${now}, but ${CHANGELOG} has no entry for it. Add "### ${now} (YYYY-MM-DD)" under "## ${p}", with 1-4 lines on what changed for the user.`);
    } else if (gap) {
      errors.push(`${p}: the ${CHANGELOG} entry for ${now} is empty. Under "### ${now}" in "## ${p}", write 1-4 lines on what changed for the user.`);
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
  addChangelogEntry(p, next);
}

// An empty entry at the top of the plugin's section. check fails until the
// "- " line says what changed.
function addChangelogEntry(p, version) {
  const lines = changelogLines();
  if (!lines.length) lines.push("# Changelog", "");
  const today = new Date().toISOString().slice(0, 10);
  const entry = [`### ${version} (${today})`, "", "- ", ""];
  const s = sectionOf(lines, p);
  if (!s) {
    while (lines.length && lines.at(-1) === "") lines.pop();
    lines.push("", `## ${p}`, "", ...entry);
  } else if (!lines.some((l, i) => i > s.start && i < s.end && isEntry(l, version))) {
    let at = s.start + 1;
    while (at < s.end && lines[at].trim() === "") at++;
    lines.splice(at, 0, ...entry);
  }
  fs.writeFileSync(path.join(root, CHANGELOG), lines.join("\n"));
  console.log(`Write what changed for the user under "### ${version}" in ${CHANGELOG}, "## ${p}". check fails until you do.`);
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
