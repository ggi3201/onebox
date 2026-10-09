#!/usr/bin/env node
// Plugin versions. Claude Code updates an installed plugin only when its
// version changes, so every change under plugins/<plugin>/ needs a new version.
//
//   node scripts/versions.mjs check [--base origin/main]
//       Fails when a plugin changed since the base and its version did not go
//       up (a skill moved from one plugin to another counts for both), when
//       a new version has no entry in CHANGELOG.md, when plugin.json and
//       marketplace.json disagree, or when a plugin folder has no entry in
//       marketplace.json. A removed plugin is skipped.
//   node scripts/versions.mjs bump <plugin> [patch|minor]
//       Raises the version in both files, and adds an empty entry for it to
//       CHANGELOG.md. patch (the default) for a fix, minor for a new skill.
//   node scripts/versions.mjs codex
//       Writes the Codex manifests from the Claude Code ones: each
//       plugins/<plugin>/.codex-plugin/plugin.json and
//       .agents/plugins/marketplace.json. Do not edit those files by hand.
//       check fails when they differ from what this writes; bump rewrites them.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MARKET = ".claude-plugin/marketplace.json";
const CHANGELOG = "CHANGELOG.md";
const pluginFile = (p) => `plugins/${p}/.claude-plugin/plugin.json`;
const CODEX_MARKET = ".agents/plugins/marketplace.json";
const codexPluginFile = (p) => `plugins/${p}/.codex-plugin/plugin.json`;
// Codex wants a category on each plugin. All onebox plugins are dev tools.
const CODEX_CATEGORY = "Developer Tools";

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
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

// The Codex manifests, as { file: text }, built from the Claude Code ones.
// Codex reads the same skills/ folders, so only the manifests differ.
// Schema: the plugin-creator skill in github.com/openai/plugins,
// .agents/skills/plugin-creator/references/plugin-json-spec.md.
function codexFiles() {
  const market = readJson(MARKET);
  const files = {};
  for (const entry of market.plugins) {
    const own = readJson(pluginFile(entry.name));
    const manifest = { name: own.name, version: own.version, description: own.description };
    for (const key of ["author", "homepage", "repository", "license", "keywords"]) {
      if (own[key] !== undefined) manifest[key] = own[key];
    }
    manifest.skills = "./skills/";
    manifest.interface = {
      displayName: own.name,
      developerName: own.author?.name,
      category: CODEX_CATEGORY,
    };
    files[codexPluginFile(entry.name)] = JSON.stringify(manifest, null, 2) + "\n";
  }
  const codexMarket = {
    name: market.name,
    interface: { displayName: market.name },
    plugins: market.plugins.map((entry) => ({
      name: entry.name,
      source: { source: "local", path: entry.source },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: CODEX_CATEGORY,
    })),
  };
  files[CODEX_MARKET] = JSON.stringify(codexMarket, null, 2) + "\n";
  return files;
}

function writeCodex() {
  for (const [file, text] of Object.entries(codexFiles())) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
}

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
  const listed = new Set(market.plugins.map((e) => e.name));
  for (const entry of market.plugins) {
    if (!fs.existsSync(path.join(root, pluginFile(entry.name)))) {
      errors.push(`${entry.name}: marketplace.json lists it, but ${pluginFile(entry.name)} does not exist`);
      continue;
    }
    const own = readJson(pluginFile(entry.name)).version;
    if (own !== entry.version) {
      errors.push(`${entry.name}: plugin.json says ${own}, marketplace.json says ${entry.version}`);
    }
  }
  // Every plugin folder with tracked files needs an entry, or /plugin install
  // cannot find it. A plain file directly under plugins/ is not a plugin.
  const folders = new Set(
    git("ls-files", "plugins/").split("\n").filter((f) => f.split("/").length > 2).map((f) => f.split("/")[1]),
  );
  for (const p of folders) {
    if (!listed.has(p)) errors.push(`${p}: plugins/${p}/ has files, but ${MARKET} has no entry for it`);
  }

  for (const [file, text] of Object.entries(codexFiles())) {
    const full = path.join(root, file);
    if (!fs.existsSync(full) || fs.readFileSync(full, "utf8") !== text) {
      errors.push(`${file} does not match the Claude Code manifests. Run: node scripts/versions.mjs codex`);
    }
  }

  // The Codex manifests are made from plugin.json, so a change to them alone
  // needs no new version. --no-renames: a file moved from one plugin to another
  // is a delete in the first and an add in the second, so both count.
  const since = git("merge-base", "HEAD", base);
  const changed = new Set(
    git("diff", "--no-renames", "--name-only", since, "--", "plugins/", ":(exclude)plugins/*/.codex-plugin/*")
      .split("\n")
      .filter((f) => f.split("/").length > 2)
      .map((f) => f.split("/")[1]),
  );
  for (const p of [...changed]) {
    // A removed plugin has no plugin.json and no version to raise.
    if (!fs.existsSync(path.join(root, pluginFile(p)))) {
      changed.delete(p);
      continue;
    }
    let before = null; // a new plugin: any version is new
    try {
      before = JSON.parse(git("show", `${since}:${pluginFile(p)}`)).version;
    } catch {}
    const now = readJson(pluginFile(p)).version;
    if (before && !newer(now, before)) {
      const state = now === before ? `the version is still ${now}` : `the version went down from ${before} to ${now}`;
      errors.push(`${p}: files changed since ${base}, but ${state}. Run: node scripts/versions.mjs bump ${p}`);
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
  writeCodex();
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
  } else if (cmd === "codex") {
    writeCodex();
    console.log(`wrote ${Object.keys(codexFiles()).join(", ")}`);
  } else {
    console.error("usage: versions.mjs check [--base <ref>] | bump <plugin> [patch|minor] | codex");
    process.exit(2);
  }
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
