#!/usr/bin/env node
/**
 * Video generation via kie.ai (default), fal.ai, or Replicate.
 *
 * Provider queue mechanics (submit/poll/upload) live in ./providers.mjs,
 * which is kept byte-identical between plugins/content/skills/image/scripts
 * and plugins/content/skills/video/scripts — see that file's header.
 *
 * kie.ai video model ids, input fields and endpoints verified against
 * docs.kie.ai on 2026-09-28. Each one has its own input shape, so this file
 * builds the right `input` object per model rather than assuming one schema:
 *
 *   kling-2.6/text-to-video        https://docs.kie.ai/market/kling/text-to-video
 *   kling-2.6/image-to-video       https://docs.kie.ai/market/kling/image-to-video
 *   kling/v3-turbo-image-to-video  https://docs.kie.ai/market/kling/v3-turbo-image-to-video
 *   kling/v2-1-pro                 same model already used by
 *                                   image/scripts/kie.mjs's `shot` command —
 *                                   first frame + --tail last-frame pinning,
 *                                   image_url/tail_image_url (singular)
 *   veo-3-1                        https://docs.kie.ai/veo3-api/generate-veo-3-video
 *                                   (served through the unified jobs/createTask
 *                                   endpoint, not a dedicated /veo/ path)
 *   bytedance/seedance-2           https://docs.kie.ai/market/bytedance/seedance-2
 *                                   (native first_frame_url + last_frame_url —
 *                                   the only kie.ai model here that takes both
 *                                   ends of a shot as input directly)
 *   runway                         https://docs.kie.ai/runway-api/generate-ai-video
 *   minimax-h3/text-to-video        https://docs.kie.ai/market/minimax-h3/text-to-video
 *                                   (text-to-video only — no image input in
 *                                   the docs as of this check)
 *
 * None of the six confirmed today expose a `seed` field on kie.ai's unified
 * endpoint. --seed is still accepted: it's forwarded as-is on fal/Replicate
 * (both commonly support it) and, on kie.ai, only through --extra (see
 * below), with a warning that it may simply be ignored by the model.
 *
 * COMMANDS
 *   probe                                            kie.ai credit balance (kie only)
 *   text-to-video <prompt> <out.mp4>       [opts]
 *   image-to-video <prompt> <head.png> <out.mp4> [--tail last.png] [opts]
 *   chain <out-dir> <head.png> --legs N --prompt "<move>" [opts]
 *
 * OPTIONS (all commands unless noted)
 *   --provider kie|fal|replicate   default: media.videoProvider, else "kie"
 *   --model <id>                   default depends on command, see below
 *   --dur <seconds>                 --ar <16:9|9:16|...>   --resolution <720p|...>
 *   --seed <n>                      --extra '<json>'  merged into the built input
 *   --dry-run                       print the request + a cost estimate, call nothing
 *
 * KEY
 *   Resolved per CONFIG.md's `media` section: media.videoProvider and
 *   media.providers.<name>.keyRef, falling back to the provider's default
 *   env var name (KIE_AI_API_KEY / FAL_KEY / REPLICATE_API_TOKEN). The old
 *   `images.provider`/`images.keyRef` keys still work for the kie.ai case.
 *   Never printed. Loaded lazily — `--dry-run` and no-args usage need no key.
 *
 * FFMPEG (optional, only for `chain`)
 *   `chain` needs each leg's last frame to feed the next leg's first frame.
 *   If the provider's response already includes one (some kie.ai models do),
 *   that's used directly. Otherwise this script shells out to `ffmpeg` to
 *   grab the leg's last frame. Without ffmpeg installed, chaining fails with
 *   a clear error on any model that doesn't return a last frame itself —
 *   `text-to-video` and plain `image-to-video` don't need ffmpeg at all.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  loadConfig, resolveProviderName, loadProviderKey, makeAdapter, asUrl, download,
} from "./providers.mjs";

// ------------------------------------------------------------- models ----
// Verified 2026-09-28 against the docs.kie.ai pages listed above.
const KIE_MODELS = {
  "kling-2.6/text-to-video": {
    kind: "t2v",
    build: (o) => ({
      prompt: o.prompt,
      sound: false,
      aspect_ratio: pick(o.ar, ["1:1", "16:9", "9:16"], "16:9"),
      duration: pick(String(o.dur || "5"), ["5", "10"], "5"),
    }),
  },
  "kling-2.6/image-to-video": {
    kind: "i2v", // first frame only — no tail support in this model's schema
    build: (o) => ({
      prompt: o.prompt,
      image_urls: [o.head],
      sound: false,
      duration: pick(String(o.dur || "5"), ["5", "10"], "5"),
    }),
  },
  "kling/v3-turbo-image-to-video": {
    kind: "i2v",
    build: (o) => ({
      prompt: o.prompt,
      image_urls: [o.head],
      duration: String(o.dur || "5"),
      resolution: pick(o.resolution, ["720p", "1080p"], "720p"),
    }),
  },
  "kling/v2-1-pro": {
    kind: "i2v-tail", // the model image/scripts/kie.mjs's `shot` already uses
    build: (o) => ({
      prompt: o.prompt,
      image_url: o.head,
      ...(o.tail ? { tail_image_url: o.tail } : {}),
      duration: String(o.dur || "5"),
      negative_prompt: "blur, distortion, low quality, warping, morphing, jitter, flicker, text, watermark, cut, scene change",
      cfg_scale: 0.5,
    }),
  },
  "veo-3-1": {
    kind: "both-tail",
    build: (o) => ({
      prompt: o.prompt,
      ...(o.head ? {
        image_urls: o.tail ? [o.head, o.tail] : [o.head],
        generation_type: o.tail ? "FIRST_AND_LAST_FRAMES_2_VIDEO" : "REFERENCE_2_VIDEO",
      } : { generation_type: "TEXT_2_VIDEO" }),
      aspect_ratio: pick(o.ar, ["16:9", "9:16", "Auto"], "16:9"),
      resolution: pick(o.resolution, ["720p", "1080p", "4k"], "720p"),
      duration: pick(Number(o.dur) || 8, [4, 6, 8], 8),
    }),
  },
  "bytedance/seedance-2": {
    kind: "both-tail", // the only kie.ai model here with native first+last input
    build: (o) => ({
      prompt: o.prompt,
      ...(o.head ? { first_frame_url: o.head } : {}),
      ...(o.tail ? { last_frame_url: o.tail } : {}),
      resolution: pick(o.resolution, ["480p", "720p", "1080p", "4k"], "720p"),
      aspect_ratio: pick(o.ar, ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "adaptive"], "16:9"),
      duration: Math.min(15, Math.max(4, Number(o.dur) || 5)),
      generate_audio: false,
    }),
  },
  runway: {
    kind: "t2v+i2v", // image_url conditions the shot but there is no tail/last-frame field
    build: (o) => ({
      prompt: o.prompt,
      ...(o.head ? { image_url: o.head } : {}),
      duration: pick(Number(o.dur) || 5, [5, 10], 5),
      quality: pick(o.resolution, ["720p", "1080p"], "720p"),
      ...(o.head ? {} : { aspect_ratio: pick(o.ar, ["16:9", "4:3", "1:1", "3:4", "9:16"], "16:9") }),
    }),
  },
  "minimax-h3/text-to-video": {
    kind: "t2v",
    build: (o) => ({
      prompt: o.prompt,
      aspect_ratio: pick(o.ar, ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], "16:9"),
      duration: Math.min(15, Math.max(4, Number(o.dur) || 6)),
      resolution: pick(o.resolution, ["768P", "2K"], "2K"),
    }),
  },
};

const DEFAULT_MODEL = { t2v: "kling-2.6/text-to-video", i2v: "kling-2.6/image-to-video", tail: "bytedance/seedance-2" };

// Rough per-clip cost, from kie.ai's own market pages, checked 2026-09-28.
// Ballpark only — see guides/kie-ai.md and guides/media-providers.md.
const KIE_COST_HINTS = {
  "kling-2.6/text-to-video": "kie.ai lists Kling video tasks around 100-500 credits per clip (a few cents to ~$2 depending on tier/duration) — check kie.ai/market/kling for this model's exact rate.",
  "kling-2.6/image-to-video": "same order as kling-2.6/text-to-video — check kie.ai/market/kling.",
  "kling/v3-turbo-image-to-video": "check kie.ai/market/kling for this tier's current credit cost.",
  "kling/v2-1-pro": "roughly $0.25-$0.50 for a 5-10s clip, per the image skill's existing guide — reconfirm on kie.ai/market/kling.",
  "veo-3-1": "Veo is one of kie.ai's pricier models; check kie.ai/veo-3-1 for the current per-second rate before a batch.",
  "bytedance/seedance-2": "check kie.ai/market/bytedance for this model's current credit cost — Seedance is usually mid-range.",
  runway: "check kie.ai/runway-api for the current per-second/per-clip rate.",
  "minimax-h3/text-to-video": "check kie.ai/market/minimax-h3 for the current credit cost.",
};

function pick(value, allowed, dflt) {
  return value && allowed.includes(value) ? value : dflt;
}

// -------------------------------------------------------------- flags ----
function flag(argv, name, dflt = null) {
  const i = argv.indexOf(name);
  return i > -1 && argv[i + 1] ? argv[i + 1] : dflt;
}

function parseExtra(argv) {
  const raw = flag(argv, "--extra");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (err) { throw new Error(`--extra is not valid JSON: ${err.message}`); }
}

function commonOpts(argv, { head = null, tail = null } = {}) {
  return {
    provider: flag(argv, "--provider"),
    model: flag(argv, "--model"),
    dur: flag(argv, "--dur"),
    ar: flag(argv, "--ar"),
    resolution: flag(argv, "--resolution"),
    seed: flag(argv, "--seed"),
    dryRun: argv.includes("--dry-run"),
    extra: parseExtra(argv),
    head, tail,
  };
}

// ---------------------------------------------------------------- ffmpeg -
function hasFfmpeg() {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; }
}

function extractLastFrame(videoPath, outPng) {
  fs.mkdirSync(path.dirname(path.resolve(outPng)), { recursive: true });
  execFileSync("ffmpeg", ["-y", "-sseof", "-0.05", "-i", videoPath, "-frames:v", "1", "-q:v", "2", outPng], { stdio: "ignore" });
  return outPng;
}

// ----------------------------------------------------------- core paths --
function resolveAdapter(cfg, providerOverride) {
  const providerName = resolveProviderName(cfg, "video", providerOverride);
  const key = loadProviderKey(cfg, providerName); // throws if unresolvable — only called once we actually need it
  return { providerName, adapter: makeAdapter(providerName, key) };
}

function buildInput(modelId, o) {
  const spec = KIE_MODELS[modelId];
  const base = spec ? spec.build(o) : { prompt: o.prompt, ...(o.head ? { image_url: o.head } : {}) };
  if (o.seed != null && spec) {
    process.stderr.write(
      `  note: --seed was given but ${modelId}'s verified schema (2026-09-28) has no seed field on kie.ai — ` +
      `it will be dropped unless you also pass --extra '{"seed": ${JSON.stringify(o.seed)}}'.\n`,
    );
  } else if (o.seed != null) {
    base.seed = isNaN(Number(o.seed)) ? o.seed : Number(o.seed);
  }
  return { ...base, ...o.extra };
}

function printDryRun(providerName, modelId, input) {
  console.log(JSON.stringify({ provider: providerName, model: modelId, input }, null, 2));
  if (providerName === "kie" && KIE_COST_HINTS[modelId]) {
    console.log(`\nEstimated cost: ${KIE_COST_HINTS[modelId]}`);
  } else if (providerName === "kie") {
    console.log("\nEstimated cost: no published estimate for this model here — check kie.ai/market for its rate.");
  } else {
    console.log(`\nEstimated cost: no built-in estimate for ${providerName} models — check that provider's pricing page.`);
  }
  console.log("(--dry-run: no request was sent, no key was read)");
}

function printUsage() {
  console.error(`video generator: kie.ai (default), fal.ai, or Replicate — see guides/media-providers.md

  node video.mjs probe                                                            kie.ai credit balance
  node video.mjs text-to-video  "<prompt>" out.mp4 [--ar 16:9] [--dur 5] [opts]
  node video.mjs image-to-video "<prompt>" head.png out.mp4 [--tail last.png] [opts]
  node video.mjs chain out-dir/ head.png --legs 3 --prompt "<move>" [--prompts "p1|p2|p3"] [opts]

Common opts: --provider kie|fal|replicate  --model <id>  --resolution <720p|...>
             --seed <n>  --extra '<json merged into the request>'  --dry-run

No API key is needed just to see this message, or with --dry-run.`);
}

// ---------------------------------------------------------------- main ----
const [cmd, ...rest] = process.argv.slice(2);

// Flags that take a value, and flags that don't. Anything else starting with
// "--" is a typo; fail instead of silently using it as a file path or prompt.
const VALUE_FLAGS = new Set(["--provider", "--model", "--dur", "--ar", "--resolution", "--seed",
  "--extra", "--tail", "--legs", "--prompt", "--prompts", "--final-tail"]);
const BOOL_FLAGS = new Set(["--dry-run"]);
function positionals(argv) {
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS.has(a)) {
      if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) throw new Error(`${a} needs a value`);
      i++;
    } else if (BOOL_FLAGS.has(a)) {
      continue;
    } else if (a.startsWith("--")) {
      throw new Error(`unknown option ${a} (run with no arguments to see the options)`);
    } else pos.push(a);
  }
  return pos;
}

try {
  if (!cmd || cmd === "--help" || cmd === "-h") {
    printUsage();
    process.exit(cmd ? 0 : 1);

  } else if (cmd === "probe") {
    const cfg = loadConfig();
    const providerName = resolveProviderName(cfg, "video", flag(rest, "--provider"));
    if (providerName !== "kie") throw new Error(`probe only supports kie.ai — check your ${providerName} dashboard for balance.`);
    const key = loadProviderKey(cfg, "kie");
    const r = await fetch("https://api.kie.ai/api/v1/chat/credit", { headers: { Authorization: `Bearer ${key}` } });
    const j = await r.json();
    console.log("credit balance:", j.data);

  } else if (cmd === "text-to-video") {
    const [prompt, out] = positionals(rest);
    if (!prompt || !out) throw new Error('usage: video.mjs text-to-video "<prompt>" <out.mp4> [opts]');
    const o = { prompt, ...commonOpts(rest) };
    const cfg = loadConfig();
    const modelId = o.model || DEFAULT_MODEL.t2v;
    const input = buildInput(modelId, o);
    if (o.dryRun) { printDryRun(o.provider || resolveProviderName(cfg, "video", null), modelId, input); process.exit(0); }
    const { adapter } = resolveAdapter(cfg, o.provider);
    const jobId = await adapter.submit(modelId, input);
    const { urls } = await adapter.poll(jobId, { label: path.basename(out), timeoutMs: 20 * 60 * 1000 });
    await download(urls[0], out);
    console.log(out);

  } else if (cmd === "image-to-video") {
    const [prompt, head, out] = positionals(rest);
    if (!prompt || !head || !out) {
      throw new Error('usage: video.mjs image-to-video "<prompt>" <head.png> <out.mp4> [--tail last.png] [opts]');
    }
    const tail = flag(rest, "--tail");
    const o = { prompt, ...commonOpts(rest, { head, tail }) };
    const cfg = loadConfig();
    const modelId = o.model || DEFAULT_MODEL[tail ? "tail" : "i2v"];
    let input = buildInput(modelId, o);
    if (o.dryRun) {
      printDryRun(o.provider || resolveProviderName(cfg, "video", null), modelId, input);
      process.exit(0);
    }
    const { adapter } = resolveAdapter(cfg, o.provider);
    const headUrl = await asUrl(adapter, head);
    const tailUrl = tail ? await asUrl(adapter, tail) : null;
    input = applyFrames(modelId, input, headUrl, tailUrl);
    const jobId = await adapter.submit(modelId, input);
    const { urls } = await adapter.poll(jobId, { label: path.basename(out), timeoutMs: 20 * 60 * 1000 });
    await download(urls[0], out);
    console.log(out);

  } else if (cmd === "chain") {
    const [outDir, head] = positionals(rest);
    const legs = Number(flag(rest, "--legs", "0"));
    if (!outDir || !head || !legs) {
      throw new Error('usage: video.mjs chain <out-dir> <head.png> --legs N --prompt "<move>" [--prompts "p1|p2|p3"] [--final-tail img.png] [opts]');
    }
    const sharedPrompt = flag(rest, "--prompt");
    const promptList = flag(rest, "--prompts")?.split("|").map((s) => s.trim());
    const finalTail = flag(rest, "--final-tail");
    if (!sharedPrompt && (!promptList || promptList.length !== legs)) {
      throw new Error(`give --prompt "<one move for every leg>" or --prompts "p1|p2|...|p${legs}" (exactly ${legs} entries)`);
    }
    const o0 = commonOpts(rest);
    const modelId = o0.model || DEFAULT_MODEL.tail;
    const spec = KIE_MODELS[modelId];
    if (spec && spec.kind !== "both-tail" && spec.kind !== "i2v-tail") {
      throw new Error(`${modelId} doesn't take a last-frame input — chain needs a tail-capable model (default: ${DEFAULT_MODEL.tail}).`);
    }

    if (o0.dryRun) {
      for (let i = 0; i < legs; i++) {
        const prompt = promptList ? promptList[i] : sharedPrompt;
        const input = buildInput(modelId, { ...o0, prompt, head: `<leg ${i + 1} head>`, tail: i === legs - 1 ? (finalTail || "<none>") : `<leg ${i + 2} head, extracted after leg ${i + 1}>` });
        printDryRun(o0.provider || "kie", modelId, input);
      }
      process.exit(0);
    }

    fs.mkdirSync(outDir, { recursive: true });
    const ff = hasFfmpeg();
    if (!ff) {
      process.stderr.write(
        "  note: ffmpeg not found. Chaining will still work IF every leg's provider response includes a " +
        "last-frame image on its own; otherwise it fails as soon as one doesn't. Install ffmpeg " +
        "(e.g. `brew install ffmpeg`) to make chaining work with any model.\n",
      );
    }

    let currentHead = head;
    const { providerName, adapter } = resolveAdapter(loadConfig(), o0.provider);
    for (let i = 0; i < legs; i++) {
      const prompt = promptList ? promptList[i] : sharedPrompt;
      const legOut = path.join(outDir, `leg-${String(i + 1).padStart(2, "0")}.mp4`);
      const isLast = i === legs - 1;
      const explicitTail = isLast ? finalTail : null;

      const headUrl = await asUrl(adapter, currentHead);
      const tailUrl = explicitTail ? await asUrl(adapter, explicitTail) : null;
      let input = buildInput(modelId, { ...o0, prompt, head: currentHead, tail: explicitTail });
      input = applyFrames(modelId, input, headUrl, tailUrl);

      const jobId = await adapter.submit(modelId, input);
      const { urls, lastFrameUrl } = await adapter.poll(jobId, { label: `leg ${i + 1}/${legs}`, timeoutMs: 20 * 60 * 1000 });
      await download(urls[0], legOut);
      console.log(legOut);

      if (!isLast) {
        if (lastFrameUrl) {
          const framePath = path.join(outDir, `leg-${String(i + 1).padStart(2, "0")}-tail.png`);
          await download(lastFrameUrl, framePath);
          currentHead = framePath;
        } else if (ff) {
          currentHead = extractLastFrame(legOut, path.join(outDir, `leg-${String(i + 1).padStart(2, "0")}-tail.png`));
        } else {
          throw new Error(
            `leg ${i + 1} didn't return a last frame and ffmpeg isn't installed — can't build leg ${i + 2}'s ` +
            `first frame. Install ffmpeg, or use a model whose response includes one.`,
          );
        }
      }
    }
    console.log(`chain done: ${legs} legs in ${outDir}`);
    if (ff) {
      const listFile = path.join(outDir, "concat.txt");
      fs.writeFileSync(listFile, Array.from({ length: legs }, (_, i) => `file 'leg-${String(i + 1).padStart(2, "0")}.mp4'`).join("\n"));
      const combined = path.join(outDir, "chain.mp4");
      try {
        execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", combined], { stdio: "ignore" });
        console.log(combined);
      } catch {
        console.error("  note: leg files are all valid; the optional ffmpeg concat step failed — concatenate them yourself if needed.");
      }
    }

  } else {
    printUsage();
    process.exit(1);
  }
} catch (err) {
  console.error("ERROR:", err.message);
  process.exit(1);
}

function needsArrayHead(modelId) {
  return modelId === "kling-2.6/image-to-video" || modelId === "kling/v3-turbo-image-to-video" || modelId === "veo-3-1";
}

// Splices resolved head/tail URLs into the right field for this model,
// after buildInput() has already assembled everything else.
function applyFrames(modelId, input, headUrl, tailUrl) {
  if (modelId === "kling/v2-1-pro") {
    if (headUrl) input.image_url = headUrl;
    if (tailUrl) input.tail_image_url = tailUrl;
  } else if (modelId === "bytedance/seedance-2") {
    if (headUrl) input.first_frame_url = headUrl;
    if (tailUrl) input.last_frame_url = tailUrl;
  } else if (modelId === "runway") {
    if (headUrl) input.image_url = headUrl;
  } else if (needsArrayHead(modelId)) {
    const arr = [];
    if (headUrl) arr.push(headUrl);
    if (tailUrl) arr.push(tailUrl);
    if (arr.length) input.image_urls = arr;
  } else if (headUrl) {
    input.image_url = headUrl;
  }
  return input;
}
