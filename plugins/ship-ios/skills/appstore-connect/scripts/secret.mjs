// Read one secret, the same way in every onebox script (CONFIG.md, "Secrets").
//
// First match wins:
//   1. The environment variable named by the reference. It is there when you
//      start the agent through your secrets tool (`doppler run -- claude`).
//   2. Your command: `secrets.command` in ~/.config/onebox/config.json, with
//      {ref} in it. Never from a repo's .onebox.json: a cloned repo must not be
//      able to run a command on your Mac. `secrets.tool` "doppler" or
//      "1password" is a ready-made command, and may come from either file.
//   3. The reference in the nearest .env file, walking up from the folder.
//
// The value is returned, never printed. Do not edit a copy inside a skill:
// edit scripts/shared/secret.mjs and run `bash scripts/secret-copies.sh sync`.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** secrets.command from your own config only, never from a repo's .onebox.json. */
export function userSecretsCommand() {
  try {
    const file = path.join(os.homedir(), ".config", "onebox", "config.json");
    const command = JSON.parse(fs.readFileSync(file, "utf8"))?.secrets?.command;
    return typeof command === "string" && command.trim() ? command : null;
  } catch {
    return null;
  }
}

/** The shell command that prints the secret, or null. */
export function secretCommand(cfg, ref) {
  const s = cfg?.secrets ?? {};
  let template = userSecretsCommand();
  if (!template && s.tool === "doppler") {
    template = "doppler secrets get {ref} --plain";
    if (s.doppler?.project) template += ` -p ${quote(s.doppler.project)}`;
    if (s.doppler?.config) template += ` -c ${quote(s.doppler.config)}`;
  }
  if (!template && s.tool === "1password") template = "op read {ref}";
  return template ? template.replaceAll("{ref}", quote(ref)) : null;
}

/** "project" or "config" when neither the onebox config nor `doppler setup` sets it, else null.
 *  Without it doppler stops with "You must specify a project". DOPPLER_PROJECT / DOPPLER_CONFIG set one each. */
export function dopplerMissing(cfg) {
  if (process.env.DOPPLER_TOKEN) return null; // a service token carries both
  for (const key of ["project", "config"]) {
    if (cfg?.secrets?.doppler?.[key] || process.env[`DOPPLER_${key.toUpperCase()}`]) continue;
    let set;
    try {
      set = execFileSync("doppler", ["configure", "get", key, "--plain"], {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).trim();
    } catch {
      return null; // doppler is missing or broken: the command itself says so
    }
    if (!set) return key;
  }
  return null;
}

/** The value of NAME in the nearest .env, walking up from `start`, or null. */
export function dotenvValue(name, start = process.cwd()) {
  if (!NAME.test(name)) return null;
  const line = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`, "m");
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    const file = path.join(dir, ".env");
    if (fs.existsSync(file)) {
      const m = line.exec(fs.readFileSync(file, "utf8"));
      if (m) return m[1].trim().replace(/^(["'])([\s\S]*)\1$/, "$2") || null;
    }
    if (path.dirname(dir) === dir) return null;
  }
}

const HOW =
  "Put it in the environment (start your agent through your secrets tool, for " +
  "example `doppler run -- claude`), set secrets.command in your onebox config, " +
  "or add it to a git-ignored .env file. CONFIG.md, \"Secrets\".";

/** The secret's value. Throws with a plain sentence when it cannot be read. */
export function readSecret(cfg, ref, { timeoutMs = 60_000 } = {}) {
  if (!ref) throw new Error("no secret reference given");
  if (NAME.test(ref) && process.env[ref]) return process.env[ref];

  const command = secretCommand(cfg, ref);
  const missing = command && !userSecretsCommand() && cfg?.secrets?.tool === "doppler" && dopplerMissing(cfg);
  if (missing) {
    throw new Error(
      `secrets.tool is doppler, but no Doppler ${missing} is set. Set secrets.doppler.${missing} in ` +
      "~/.config/onebox/config.json, or run `doppler setup` in this folder. CONFIG.md, \"Secrets\".");
  }
  if (command) {
    let out;
    try {
      out = execFileSync("/bin/sh", ["-c", command], {
        encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], timeout: timeoutMs,
      });
    } catch (err) {
      if (err.code === "ETIMEDOUT" || err.signal === "SIGTERM") {
        throw new Error(
          `the secrets command for ${ref} did not answer in ${timeoutMs / 1000} s. ` +
          "It may be waiting for a prompt, such as Touch ID. " + HOW);
      }
      throw new Error(
        `the secrets command for ${ref} failed (exit ${err.status ?? "?"}). ` +
        "Check that your secrets tool is installed and signed in.");
    }
    out = out.replace(/\s+$/, "");
    if (!out) throw new Error(`the secrets command for ${ref} printed nothing`);
    return out;
  }

  const fromFile = dotenvValue(ref);
  if (fromFile) return fromFile;
  throw new Error(`secret ${ref} not found. ${HOW}`);
}
