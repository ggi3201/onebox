#!/usr/bin/env node
/**
 * Image (and optional video) generation via kie.ai's unified jobs API.
 *
 * Adapted from scroll-craft (https://github.com/nateherkai/scroll-craft),
 * MIT License, Copyright (c) 2026 Nate Herk. The original license text is
 * kept in LICENSE-kie next to this file.
 *
 *   POST https://api.kie.ai/api/v1/jobs/createTask   { model, input }
 *   GET  https://api.kie.ai/api/v1/jobs/recordInfo?taskId=...
 *
 * Model ids and endpoints verified against docs.kie.ai on 2026-09-28:
 *   seedream/5-pro-text-to-image, seedream/5-pro-image-to-image, kling/v2-1-pro
 * See ../../../../guides/kie-ai.md for the account/pricing side of this.
 *
 * `still` can also target fal.ai or Replicate with [--provider fal|replicate]
 * [--model id] [--extra '<json>'] — see ./providers.mjs (the queue/poll/upload
 * mechanics shared with the video skill) and https://onebox.lokkesveen.com/guides/media-providers.md (when
 * to pick which). The default path below (no --provider) is unchanged.
 *
 * COMMANDS
 *   still  <prompt> <out.png> [--ar 16:9] [--ref a.png] [--model id] [--quality high|basic] [--dry-run]
 *          seedream/5-pro-text-to-image (or -image-to-image with one or more
 *          --ref). Photoreal by default. Stills are cheap: generate, look,
 *          reroll rather than over-specifying the first prompt.
 *
 *   shot   <prompt> <in.png> <out.mp4> [--tail b.png] [--dur 5] [--model id]
 *          kling/v2-1-pro image-to-video. Optional — most tasks only need
 *          `still`. --tail pins the LAST frame, which is what lets two clips
 *          share a frame-identical cut: leg N's tail is leg N+1's head.
 *
 *   probe  print the account's credit balance and exit. Each call costs
 *          real money — run this before a batch and after, and read
 *          https://onebox.lokkesveen.com/guides/kie-ai.md before your first call.
 *
 * KEY
 *   Resolved per CONFIG.md: `secrets.tool` (env | doppler | 1password) and
 *   `images.keyRef` (default env var KIE_AI_API_KEY) from
 *   ~/.config/onebox/config.json, overridden by ./.onebox.json. The common
 *   case needs no config file at all: set KIE_AI_API_KEY in the environment,
 *   or put it in a .env file anywhere from the current directory up to $HOME.
 *   The key is never printed, never logged, never put in a URL.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import {
  resolveProviderName as resolveMediaProvider,
  loadProviderKey,
  makeAdapter,
  asUrl as providerAsUrl,
} from "./providers.mjs";

const API = "https://api.kie.ai";
const UPLOAD = "https://kieai.redpandaai.co/api/file-base64-upload";

const MODELS = {
  still:     "seedream/5-pro-text-to-image",
  stillEdit: "seedream/5-pro-image-to-image",
  shot:      "kling/v2-1-pro",
};

// seedream rejects some aspect ratios without saying which ones it accepts —
// an unsupported value fails at createTask with "This aspect_ratio is not
// within the range of allowed options" and no list. These are confirmed to
// work; treat the set as a floor, not the whole menu, and expect the
// returned pixel size to land near the ratio rather than exactly on it.
const VERIFIED_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "3:4", "4:3", "3:2", "2:3", "21:9"];

// ------------------------------------------------------------- config ----
function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function merge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    const b = base?.[k], o = over[k];
    out[k] = (o && typeof o === "object" && !Array.isArray(o) && b && typeof b === "object")
      ? merge(b, o)
      : o;
  }
  return out;
}

function loadConfig() {
  const user = readJsonSafe(path.join(os.homedir(), ".config", "onebox", "config.json"));
  const project = readJsonSafe(path.join(process.cwd(), ".onebox.json"));
  return merge(user, project);
}

// ------------------------------------------------------------- secret ----
function findInEnvFile(varName, start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    const p = path.join(dir, ".env");
    if (fs.existsSync(p)) {
      const re = new RegExp(`^\\s*${varName}\\s*=\\s*(.+?)\\s*$`);
      for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
        const m = line.match(re);
        if (m) return m[1].replace(/^["']|["']$/g, "");
      }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

// Loads the kie.ai key. Never prints it — callers put it straight into a
// header. Resolution order follows CONFIG.md's secrets table exactly.
function loadKey() {
  const cfg = loadConfig();
  const tool = cfg?.secrets?.tool || "env";
  const ref = cfg?.images?.keyRef || "KIE_AI_API_KEY";

  if (tool === "doppler") {
    const { project = "", config = "" } = cfg?.secrets?.doppler || {};
    try {
      return execFileSync(
        "doppler", ["secrets", "get", ref, "--plain", "-p", project, "-c", config],
        { encoding: "utf8" },
      ).trim();
    } catch (err) {
      throw new Error(`doppler could not read ${ref} (project=${project}, config=${config}): ${err.message}`);
    }
  }

  if (tool === "1password") {
    try {
      return execFileSync("op", ["read", ref], { encoding: "utf8" }).trim();
    } catch (err) {
      throw new Error(`\`op read ${ref}\` failed: ${err.message}`);
    }
  }

  // env (default): the environment first, then a .env file walking up from cwd.
  if (process.env[ref]) return process.env[ref];
  const fromEnvFile = findInEnvFile(ref, process.cwd());
  if (fromEnvFile) return fromEnvFile;

  throw new Error(
    `could not resolve the kie.ai key — looked for env var ${ref} and a .env ` +
    `entry for it. Set images.keyRef / secrets.tool in your onebox config if ` +
    `the key lives somewhere else. See https://onebox.lokkesveen.com/guides/kie-ai.md.`,
  );
}

// Built lazily, once, and only by commands that actually call the API — so
// `kie.mjs` with no args, or `--help`, never needs a key.
let _headers = null;
function authHeaders() {
  if (!_headers) _headers = { "Content-Type": "application/json", Authorization: `Bearer ${loadKey()}` };
  return _headers;
}

// ------------------------------------------------------------- helpers ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function uploadLocal(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error("input not found: " + abs);
  const ext = path.extname(abs).slice(1).toLowerCase();
  const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  const dataUrl = `data:${mime};base64,${fs.readFileSync(abs).toString("base64")}`;
  const res = await fetch(UPLOAD, {
    method: "POST", headers: authHeaders(),
    body: JSON.stringify({ base64Data: dataUrl, uploadPath: "onebox", fileName: path.basename(abs) }),
  });
  const j = await res.json();
  const url = j?.data?.downloadUrl || j?.data?.fileUrl || j?.data?.url;
  if (!url) throw new Error("upload failed: " + JSON.stringify(j));
  return url; // hosted for 3 days upstream — consume it in this same run
}

// A local path becomes a hosted URL; an http(s) string passes straight through.
const asUrl = (v) => (/^https?:\/\//i.test(v) ? Promise.resolve(v) : uploadLocal(v));

async function createTask(model, input) {
  const res = await fetch(`${API}/api/v1/jobs/createTask`, {
    method: "POST", headers: authHeaders(), body: JSON.stringify({ model, input }),
  });
  const j = await res.json();
  if (j.code !== 200 || !j?.data?.taskId) throw new Error(`createTask ${model}: ${JSON.stringify(j)}`);
  return j.data.taskId;
}

async function waitTask(taskId, { label = "job", timeoutMs = 15 * 60 * 1000 } = {}) {
  const t0 = Date.now();
  let delay = 4000;
  for (;;) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`${label}: timed out after ${Math.round((Date.now() - t0) / 1000)}s`);
    const res = await fetch(`${API}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers: authHeaders() });
    const j = await res.json();
    const d = j?.data || {};
    const state = d.state || d.status;
    if (state === "success") {
      let out = d.resultJson;
      if (typeof out === "string") { try { out = JSON.parse(out); } catch {} }
      const urls = out?.resultUrls || out?.result_urls || out?.urls || [];
      if (!urls.length) throw new Error(`${label}: success with no result url: ${JSON.stringify(d)}`);
      if (d.creditsConsumed != null) process.stderr.write(`  ${label}: ${d.creditsConsumed} credits consumed\n`);
      return urls;
    }
    if (state === "fail" || state === "failed") {
      throw new Error(`${label} failed: ${d.failMsg || d.failCode || JSON.stringify(d)}`);
    }
    process.stderr.write(`  ${label}: ${state || "queued"} (${Math.round((Date.now() - t0) / 1000)}s)\n`);
    await sleep(delay);
    delay = Math.min(delay * 1.25, 15000);
  }
}

async function download(url, out) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  fs.writeFileSync(path.resolve(out), Buffer.from(await res.arrayBuffer()));
  return out;
}

function flag(argv, name, dflt = null) {
  const i = argv.indexOf(name);
  return i > -1 && argv[i + 1] ? argv[i + 1] : dflt;
}
function flags(argv, name) {
  const out = [];
  argv.forEach((a, i) => { if (a === name && argv[i + 1]) out.push(argv[i + 1]); });
  return out;
}

function printUsage() {
  console.error(`kie.ai image generator (see https://onebox.lokkesveen.com/guides/kie-ai.md for setup and pricing)

  node kie.mjs probe
  node kie.mjs still "<prompt>" <out.png> [--ar 16:9] [--ref ref.png] [--model id] [--quality high|basic]
  node kie.mjs shot  "<prompt>" <head.png> <out.mp4> [--tail tail.png] [--dur 5] [--model id]

\`still\` also takes [--provider kie|fal|replicate] [--extra '<json>'] [--dry-run] —
see https://onebox.lokkesveen.com/guides/media-providers.md for when to reach for fal.ai or Replicate instead.
Verified aspect ratios: ${VERIFIED_ASPECT_RATIOS.join(", ")} (others may work but are unconfirmed).
No API key is needed just to see this message.`);
}

// ---------------------------------------------------------------- main ----
const [cmd, ...rest] = process.argv.slice(2);

try {
  if (!cmd || cmd === "--help" || cmd === "-h") {
    printUsage();
    process.exit(cmd ? 0 : 1);

  } else if (cmd === "probe") {
    const r = await fetch(`${API}/api/v1/chat/credit`, { headers: authHeaders() });
    const j = await r.json();
    console.log("credit balance:", j.data);

  } else if (cmd === "still") {
    const [prompt, out] = rest;
    if (!prompt || !out) {
      throw new Error('usage: kie.mjs still "<prompt>" <out.png> [--ar 16:9] [--ref a.png] [--model id] [--provider kie|fal|replicate] [--dry-run]');
    }
    const ar = flag(rest, "--ar", "16:9");
    const refs = flags(rest, "--ref");
    const modelOverride = flag(rest, "--model");
    const dryRun = rest.includes("--dry-run");
    const cfg = loadConfig();
    const providerName = resolveMediaProvider(cfg, "image", flag(rest, "--provider"));

    if (providerName !== "kie") {
      // Only kie.ai gets a hand-built seedream request below. Another
      // provider needs --model plus its own input shape — pass that via
      // --extra '<json>'. See https://onebox.lokkesveen.com/guides/media-providers.md.
      if (!modelOverride) throw new Error(`--provider ${providerName} needs --model <id> — this script only knows seedream's shape for kie.ai.`);
      let input = { prompt, aspect_ratio: ar };
      const extraRaw = flag(rest, "--extra");
      if (extraRaw) {
        try { input = { ...input, ...JSON.parse(extraRaw) }; } catch (err) { throw new Error(`--extra is not valid JSON: ${err.message}`); }
      }
      if (dryRun) {
        console.log(JSON.stringify({ provider: providerName, model: modelOverride, input }, null, 2));
        console.log("\nEstimated cost: no built-in estimate for this provider — check its pricing page.");
        console.log("(--dry-run: no request was sent, no key was read)");
      } else {
        const key = loadProviderKey(cfg, providerName);
        const adapter = makeAdapter(providerName, key);
        if (refs.length) input.image_urls = await Promise.all(refs.map((r) => providerAsUrl(adapter, r)));
        const jobId = await adapter.submit(modelOverride, input);
        const { urls } = await adapter.poll(jobId, { label: path.basename(out) });
        await download(urls[0], out);
        console.log(out);
      }

    } else {
      let model = modelOverride || (refs.length ? MODELS.stillEdit : MODELS.still);
      // aspect_ratio, quality and output_format are all required by seedream;
      // omitting any one returns a bare "This field is required" that does not
      // name the field, so keep them explicit rather than relying on defaults.
      const input = {
        prompt,
        aspect_ratio: ar,
        quality: flag(rest, "--quality", "high"),
        output_format: flag(rest, "--format", "png"),
        nsfw_checker: false,
      };
      if (refs.length) {
        input.image_urls = await Promise.all(refs.map(asUrl));
      }
      if (dryRun) {
        console.log(JSON.stringify({ provider: "kie", model, input }, null, 2));
        console.log("\nEstimated cost: a seedream still runs roughly $0.03-$0.08 depending on quality tier — see https://onebox.lokkesveen.com/guides/kie-ai.md.");
        console.log("(--dry-run: no request was sent, no key was read)");
      } else {
        const id = await createTask(model, input);
        const urls = await waitTask(id, { label: path.basename(out) });
        await download(urls[0], out);
        console.log(out);
      }
    }

  } else if (cmd === "shot") {
    const [prompt, head, out] = rest;
    if (!prompt || !head || !out) {
      throw new Error('usage: kie.mjs shot "<prompt>" <head.png> <out.mp4> [--tail b.png] [--dur 5] [--model id]');
    }
    const dur = flag(rest, "--dur", "5");
    const tail = flag(rest, "--tail");
    const model = flag(rest, "--model", MODELS.shot);
    const input = {
      prompt,
      image_url: await asUrl(head),
      duration: String(dur),
      // Camera-move clips are graded on smoothness, so the negative prompt
      // targets exactly what breaks a scrub: judder, warping, cuts.
      negative_prompt: "blur, distortion, low quality, warping, morphing, jitter, flicker, text, watermark, cut, scene change",
      cfg_scale: 0.5,
    };
    if (tail) input.tail_image_url = await asUrl(tail);
    const id = await createTask(model, input);
    const urls = await waitTask(id, { label: path.basename(out), timeoutMs: 20 * 60 * 1000 });
    await download(urls[0], out);
    console.log(out);

  } else {
    printUsage();
    process.exit(1);
  }
} catch (err) {
  console.error("ERROR:", err.message);
  process.exit(1);
}
