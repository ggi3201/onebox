// Read one secret, the same way in every onebox script (CONFIG.md, "Secrets").
//
// First match wins:
//   1. The environment variable named by the reference. It is there when you
//      start the agent through your secrets tool (`doppler run -- claude`).
//   2. Your command: `secrets.command` in the onebox config, with {ref} in it.
//      `secrets.tool` "doppler" or "1password" is a ready-made command.
//   3. The reference in the nearest .env file, walking up from the folder.
//
// The value is returned, never printed. Do not edit a copy inside a skill:
// edit scripts/shared/secret.mjs and run `bash scripts/secret-copies.sh sync`.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** The shell command that prints the secret, from the config, or null. */
export function secretCommand(cfg, ref) {
  const s = cfg?.secrets ?? {};
  let template = s.command;
  if (!template && s.tool === "doppler") {
    template = "doppler secrets get {ref} --plain";
    if (s.doppler?.project) template += ` -p ${quote(s.doppler.project)}`;
    if (s.doppler?.config) template += ` -c ${quote(s.doppler.config)}`;
  }
  if (!template && s.tool === "1password") template = "op read {ref}";
  return template ? template.replaceAll("{ref}", quote(ref)) : null;
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
