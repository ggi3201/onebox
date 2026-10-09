#!/usr/bin/env node
/**
 * Shared provider adapters for image and video generation (kie.ai, fal.ai,
 * Replicate). This file is kept byte-identical in
 * plugins/content/skills/image/scripts/providers.mjs and
 * plugins/content/skills/video/scripts/providers.mjs, because each skill
 * must install standalone (see CONTRIBUTING.md). If you edit one copy, copy
 * it over the other.
 *
 * The kie.ai adapter below calls the same two endpoints already used in
 * image/scripts/kie.mjs (createTask / recordInfo / the redpandaai upload
 * host) — see that file and NOTICE.md for the third-party attribution on
 * where that pattern came from. Nothing in this file is copied from
 * anywhere; it is freshly written glue around each provider's own public
 * HTTP API.
 *
 * fal.ai and Replicate API shapes verified 2026-09-28 against:
 *   https://fal.ai/docs (queue API: submit/status/result, `Authorization: Key`)
 *   https://replicate.com/docs/reference/http (predictions API, `Authorization: Bearer`)
 * fal's raw REST upload endpoint is not publicly documented (only its SDKs
 * are) — see uploadLocal() below for what this file does instead.
 *
 * CONFIG.md's `media` section decides which provider each skill uses:
 *   media.imageProvider / media.videoProvider (default "kie")
 *   media.providers.<name>.keyRef            (default env var per provider)
 * The old `images.provider` / `images.keyRef` keys still work as a fallback
 * for the image skill — see resolveProvider() below.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readSecret } from "./secret.mjs";

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

export function loadConfig() {
  const user = readJsonSafe(path.join(os.homedir(), ".config", "onebox", "config.json"));
  const project = readJsonSafe(path.join(process.cwd(), ".onebox.json"));
  return merge(user, project);
}

const DEFAULT_KEY_REF = {
  kie: "KIE_AI_API_KEY",
  fal: "FAL_KEY",
  replicate: "REPLICATE_API_TOKEN",
};

// Picks the provider name for `kind` ("image" | "video"), honoring a CLI
// override first, then media.<kind>Provider, then (image only) the legacy
// images.provider, then "kie".
export function resolveProviderName(cfg, kind, cliOverride) {
  if (cliOverride) return cliOverride;
  const mediaKey = kind === "video" ? "videoProvider" : "imageProvider";
  if (cfg?.media?.[mediaKey]) return cfg.media[mediaKey];
  if (kind === "image" && cfg?.images?.provider) return cfg.images.provider;
  return "kie";
}

// Picks the secret reference for a resolved provider name.
export function resolveKeyRef(cfg, providerName) {
  const fromMedia = cfg?.media?.providers?.[providerName]?.keyRef;
  if (fromMedia) return fromMedia;
  // Legacy fallback: images.keyRef only ever meant the kie.ai key.
  if (providerName === "kie" && cfg?.images?.keyRef) return cfg.images.keyRef;
  return DEFAULT_KEY_REF[providerName] || null;
}

// ------------------------------------------------------------- secret ----
// Reads a secret reference (CONFIG.md, "Secrets"): the environment, then your
// secrets command, then the nearest .env. Never prints the value.
export function loadSecret(cfg, ref) {
  return readSecret(cfg, ref);
}

// Loads the key for a resolved provider, by name, lazily (only call this
// from inside a command that actually reaches the network).
export function loadProviderKey(cfg, providerName) {
  const ref = resolveKeyRef(cfg, providerName);
  if (!ref) throw new Error(`no key reference configured for provider "${providerName}"`);
  return loadSecret(cfg, ref);
}

// ------------------------------------------------------------- helpers ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A job is paid for once it is submitted, and it runs on whatever this
// script does. So one failed status request must not end the wait: retry,
// and give up only after several in a row. Every message names the job, so
// a result that finishes later can still be fetched.
const MAX_POLL_MISSES = 5;
async function pollJson(url, init, miss, jobId) {
  try {
    const res = await fetch(url, init);
    const j = await res.json();
    miss.count = 0;
    return j;
  } catch (err) {
    miss.count = (miss.count || 0) + 1;
    if (miss.count >= MAX_POLL_MISSES) {
      throw new Error(`status check failed ${miss.count} times in a row (${err.message}). Job ${jobId} may still finish: it is on your account.`);
    }
    process.stderr.write(`  status check failed (${miss.count}/${MAX_POLL_MISSES}), trying again: ${err.message}\n`);
    return null;
  }
}
const submitted = (provider, id) => process.stderr.write(`  submitted: ${provider} job ${id}\n`);
const timedOut = (label, t0, jobId) =>
  new Error(`${label}: timed out after ${Math.round((Date.now() - t0) / 1000)}s. Job ${jobId} may still finish: it is on your account.`);

function guessMime(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png" || ext === "webp" || ext === "gif") return `image/${ext}`;
  return "application/octet-stream";
}

// Walks an arbitrary JSON value looking for output URLs, since fal and
// Replicate models each shape their result differently (a bare string, an
// array of strings, or objects with a `url`/`video_url`/`image_url` field).
// This is deliberately generic rather than per-model — "in spirit" shared
// adapter code, not a normalized schema.
function findUrls(value, out = []) {
  if (typeof value === "string" && /^https?:\/\//i.test(value)) out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => findUrls(v, out));
  else if (value && typeof value === "object") {
    for (const k of ["url", "video_url", "image_url", "video", "output"]) {
      if (value[k] != null) findUrls(value[k], out);
    }
    if (!("url" in value) && !("video_url" in value) && !("image_url" in value)
      && !("video" in value) && !("output" in value)) {
      Object.values(value).forEach((v) => findUrls(v, out));
    }
  }
  return out;
}

// -------------------------------------------------------- kie.ai adapter --
function kieAdapter(key) {
  const API = "https://api.kie.ai";
  const UPLOAD = "https://kieai.redpandaai.co/api/file-base64-upload";
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };

  return {
    name: "kie",

    async uploadLocal(file) {
      const abs = path.resolve(file);
      if (!fs.existsSync(abs)) throw new Error("input not found: " + abs);
      const dataUrl = `data:${guessMime(abs)};base64,${fs.readFileSync(abs).toString("base64")}`;
      const res = await fetch(UPLOAD, {
        method: "POST", headers,
        body: JSON.stringify({ base64Data: dataUrl, uploadPath: "onebox", fileName: path.basename(abs) }),
      });
      const j = await res.json();
      const url = j?.data?.downloadUrl || j?.data?.fileUrl || j?.data?.url;
      if (!url) throw new Error("kie.ai upload failed: " + JSON.stringify(j));
      return url; // hosted for 3 days upstream — consume it in this same run
    },

    async submit(model, input) {
      const res = await fetch(`${API}/api/v1/jobs/createTask`, {
        method: "POST", headers, body: JSON.stringify({ model, input }),
      });
      const j = await res.json();
      if (j.code !== 200 || !j?.data?.taskId) throw new Error(`kie.ai createTask ${model}: ${JSON.stringify(j)}`);
      submitted("kie.ai", j.data.taskId);
      return j.data.taskId;
    },

    async poll(jobId, { label = "job", timeoutMs = 15 * 60 * 1000 } = {}) {
      const t0 = Date.now();
      const miss = {};
      let delay = 4000;
      for (;;) {
        if (Date.now() - t0 > timeoutMs) throw timedOut(label, t0, jobId);
        const j = await pollJson(`${API}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(jobId)}`, { headers }, miss, jobId);
        if (!j) { await sleep(delay); continue; }
        const d = j?.data || {};
        const state = d.state || d.status;
        if (state === "success") {
          let out = d.resultJson;
          if (typeof out === "string") { try { out = JSON.parse(out); } catch {} }
          const urls = out?.resultUrls || out?.result_urls || out?.urls || [];
          if (!urls.length) throw new Error(`${label}: success with no result url: ${JSON.stringify(d)}`);
          if (d.creditsConsumed != null) process.stderr.write(`  ${label}: ${d.creditsConsumed} credits consumed\n`);
          // Some kie.ai video models echo a last-frame image back in the
          // same payload (e.g. as lastFrameUrl) — hand it back so callers
          // (chain, in particular) can skip an ffmpeg extraction step.
          const lastFrameUrl = out?.lastFrameUrl || out?.last_frame_url || out?.endFrameUrl || null;
          return { urls, lastFrameUrl, raw: d };
        }
        if (state === "fail" || state === "failed") {
          throw new Error(`${label} failed: ${d.failMsg || d.failCode || JSON.stringify(d)}`);
        }
        process.stderr.write(`  ${label}: ${state || "queued"} (${Math.round((Date.now() - t0) / 1000)}s)\n`);
        await sleep(delay);
        delay = Math.min(delay * 1.25, 15000);
      }
    },
  };
}

// -------------------------------------------------------- fal.ai adapter --
function falAdapter(key) {
  const headers = { "Content-Type": "application/json", Authorization: `Key ${key}` };

  return {
    name: "fal",

    // fal's SDKs (fal_client.upload_file / fal.storage.upload) handle
    // uploads through an undocumented two-step signed-URL flow. Rather than
    // guess at that private contract, this adapter embeds the file as a
    // base64 data URI, which fal's own model docs list as an accepted form
    // for an image_url field alongside a hosted URL. That works for
    // reference-image-sized files; for anything large, host it yourself and
    // pass the https URL instead (any http(s) string bypasses uploadLocal).
    async uploadLocal(file) {
      const abs = path.resolve(file);
      if (!fs.existsSync(abs)) throw new Error("input not found: " + abs);
      const stat = fs.statSync(abs);
      if (stat.size > 8 * 1024 * 1024) {
        throw new Error(
          `${file} is ${(stat.size / 1e6).toFixed(1)}MB — too large to inline as a data URI. ` +
          `Host it and pass the https URL instead (fal's REST upload endpoint isn't public).`,
        );
      }
      return `data:${guessMime(abs)};base64,${fs.readFileSync(abs).toString("base64")}`;
    },

    // `model` is fal's endpoint path, e.g. "fal-ai/kling-video/v2.1/standard/image-to-video".
    async submit(model, input) {
      const res = await fetch(`https://queue.fal.run/${model}`, {
        method: "POST", headers, body: JSON.stringify(input),
      });
      const j = await res.json();
      if (!j?.request_id) throw new Error(`fal submit ${model}: ${JSON.stringify(j)}`);
      submitted("fal", j.request_id);
      return JSON.stringify({ requestId: j.request_id, model, statusUrl: j.status_url, responseUrl: j.response_url });
    },

    async poll(jobIdJson, { label = "job", timeoutMs = 15 * 60 * 1000 } = {}) {
      const { requestId, model, statusUrl, responseUrl } = JSON.parse(jobIdJson);
      const statusEndpoint = statusUrl || `https://queue.fal.run/${model}/requests/${requestId}/status`;
      const resultEndpoint = responseUrl || `https://queue.fal.run/${model}/requests/${requestId}`;
      const t0 = Date.now();
      const miss = {};
      let delay = 3000;
      for (;;) {
        if (Date.now() - t0 > timeoutMs) throw timedOut(label, t0, requestId);
        const j = await pollJson(statusEndpoint, { headers }, miss, requestId);
        if (!j) { await sleep(delay); continue; }
        if (j.status === "COMPLETED") {
          // fal has no failed status: a failed request is COMPLETED with an
          // `error`, and its result is a 4xx/5xx whose body links fal's docs.
          // Without these checks that docs page was saved as the output.
          if (j.error) throw new Error(`${label} failed: ${typeof j.error === "string" ? j.error : JSON.stringify(j.error)}`);
          const r = await fetch(resultEndpoint, { headers });
          const result = await r.json().catch(() => null);
          if (!r.ok) throw new Error(`${label} failed (${r.status}): ${JSON.stringify(result?.detail ?? result)}`);
          const urls = findUrls(result);
          if (!urls.length) throw new Error(`${label}: completed with no result url found: ${JSON.stringify(result)}`);
          return { urls, lastFrameUrl: null, raw: result };
        }
        if (j.status === "ERROR" || j.status === "FAILED") {
          throw new Error(`${label} failed: ${JSON.stringify(j)}`);
        }
        process.stderr.write(`  ${label}: ${j.status || "queued"} (${Math.round((Date.now() - t0) / 1000)}s)\n`);
        await sleep(delay);
        delay = Math.min(delay * 1.25, 10000);
      }
    },
  };
}

// ------------------------------------------------------ Replicate adapter -
function replicateAdapter(key) {
  const API = "https://api.replicate.com/v1";
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };

  return {
    name: "replicate",

    async uploadLocal(file) {
      const abs = path.resolve(file);
      if (!fs.existsSync(abs)) throw new Error("input not found: " + abs);
      const stat = fs.statSync(abs);
      if (stat.size <= 256 * 1024) {
        return `data:${guessMime(abs)};base64,${fs.readFileSync(abs).toString("base64")}`;
      }
      // Replicate's file upload endpoint (`POST /v1/files`, multipart,
      // `content` field) — files expire after 24h, max 100MiB.
      const form = new FormData();
      form.append("content", new Blob([fs.readFileSync(abs)]), path.basename(abs));
      const res = await fetch(`${API}/files`, {
        method: "POST", headers: { Authorization: headers.Authorization }, body: form,
      });
      const j = await res.json();
      const url = j?.urls?.get;
      if (!url) throw new Error("Replicate file upload failed: " + JSON.stringify(j));
      return url;
    },

    // Two forms. An official model ("owner/name", no version id) runs at
    // POST /v1/models/{owner}/{name}/predictions, which always uses its
    // latest version. Any other model needs "owner/name:version_id" and the
    // generic POST /v1/predictions. The version id is on the model's
    // replicate.com page, under "Versions".
    async submit(model, input) {
      const [name, version] = model.split(":");
      if (!version && !/^[\w.-]+\/[\w.-]+$/.test(name)) {
        throw new Error(`Replicate model "${model}": pass owner/name for an official model, or owner/name:version_id.`);
      }
      const res = version
        ? await fetch(`${API}/predictions`, { method: "POST", headers, body: JSON.stringify({ version, input }) })
        : await fetch(`${API}/models/${name}/predictions`, { method: "POST", headers, body: JSON.stringify({ input }) });
      const j = await res.json();
      if (!j?.id) throw new Error(`Replicate create prediction: ${JSON.stringify(j)}`);
      submitted("Replicate", j.id);
      return j.id;
    },

    async poll(jobId, { label = "job", timeoutMs = 15 * 60 * 1000 } = {}) {
      const t0 = Date.now();
      const miss = {};
      let delay = 3000;
      for (;;) {
        if (Date.now() - t0 > timeoutMs) throw timedOut(label, t0, jobId);
        const j = await pollJson(`${API}/predictions/${jobId}`, { headers }, miss, jobId);
        if (!j) { await sleep(delay); continue; }
        if (j.status === "succeeded") {
          const urls = findUrls(j.output);
          if (!urls.length) throw new Error(`${label}: succeeded with no output url: ${JSON.stringify(j.output)}`);
          return { urls, lastFrameUrl: null, raw: j };
        }
        if (j.status === "failed" || j.status === "canceled") {
          throw new Error(`${label} ${j.status}: ${j.error || JSON.stringify(j)}`);
        }
        process.stderr.write(`  ${label}: ${j.status || "queued"} (${Math.round((Date.now() - t0) / 1000)}s)\n`);
        await sleep(delay);
        delay = Math.min(delay * 1.25, 10000);
      }
    },
  };
}

export const ADAPTERS = { kie: kieAdapter, fal: falAdapter, replicate: replicateAdapter };

// Builds an adapter for a resolved provider name and key. Every adapter
// exposes the same three async methods: submit(model, input) -> jobId,
// poll(jobId, opts) -> { urls, lastFrameUrl, raw }, uploadLocal(file) -> url.
export function makeAdapter(providerName, key) {
  const factory = ADAPTERS[providerName];
  if (!factory) throw new Error(`unknown provider "${providerName}" — expected one of: ${Object.keys(ADAPTERS).join(", ")}`);
  return factory(key);
}

// A local path becomes a hosted (or inline data:) URL; an http(s) string
// passes straight through untouched.
export const asUrl = (adapter, v) => (/^https?:\/\//i.test(v) ? Promise.resolve(v) : adapter.uploadLocal(v));

export async function download(url, out) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  fs.writeFileSync(path.resolve(out), Buffer.from(await res.arrayBuffer()));
  return out;
}
