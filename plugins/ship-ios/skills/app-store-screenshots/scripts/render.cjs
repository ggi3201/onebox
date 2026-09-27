// Render every .slide in <set>/source/index.html to exact-size opaque sRGB PNGs.
//
//   node render.cjs <set-dir> [<set-dir> ...]
//
// The page is one horizontal strip of slides. Each slide is `slideW` logical
// px wide and is rendered at `dpr`, so 440 x 956 at 3x gives 1320 x 2868.
// Override per page with <body data-slide-w=".." data-slide-h=".." data-dpr=".."
// data-out="iphone-6.9">. Output goes to <set-dir>/<out>/NN-<data-name>.png
// plus <set-dir>/<basename>-overview.png.
//
// Needs playwright (with Chrome) and sharp. It tries a normal require first,
// then $NODE_DEPS (a node_modules dir that has them). One way to get both:
//   mkdir -p ~/.cache/onebox-render && cd ~/.cache/onebox-render && npm i playwright sharp
//   NODE_DEPS=~/.cache/onebox-render/node_modules node render.cjs <set>
const path = require('path');
const fs = require('fs');

function load(name) {
  const dirs = [process.env.NODE_DEPS];
  try { return require(name); } catch {}
  for (const d of dirs.filter(Boolean)) { try { return require(path.join(d, name)); } catch {} }
  throw new Error(`Cannot find ${name}. npm i -g ${name} or set NODE_DEPS to a node_modules dir that has it.`);
}
const { chromium } = load('playwright');
const sharp = load('sharp');

(async () => {
  const sets = process.argv.slice(2);
  if (!sets.length) { console.error('usage: node render.cjs <set-dir> [...]'); process.exit(2); }
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  for (const set of sets) {
    const dir = path.resolve(set);
    const url = 'file://' + path.join(dir, 'source', 'index.html');
    const page = await browser.newPage({ viewport: { width: 440, height: 956 } });
    await page.goto(url);
    const cfg = await page.evaluate(() => ({
      w: +(document.body.dataset.slideW || 440), h: +(document.body.dataset.slideH || 956),
      dpr: +(document.body.dataset.dpr || 3), out: document.body.dataset.out || 'iphone-6.9',
      n: document.querySelectorAll('.slide').length,
      names: [...document.querySelectorAll('.slide')].map((e, i) => e.dataset.name || 'slide-' + (i + 1)),
    }));
    await page.close();
    const p = await browser.newPage({ viewport: { width: cfg.w * cfg.n, height: cfg.h }, deviceScaleFactor: cfg.dpr });
    await p.goto(url);
    await p.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode().catch(() => {}))); });
    const broken = await p.evaluate(() => [...document.images].filter(i => !i.naturalWidth).map(i => i.src));
    if (broken.length) throw new Error('Images failed to load:\n' + broken.join('\n'));

    const out = path.join(dir, cfg.out);
    fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
    const strip = await p.screenshot({ clip: { x: 0, y: 0, width: cfg.w * cfg.n, height: cfg.h } });
    const W = cfg.w * cfg.dpr, H = cfg.h * cfg.dpr, tw = 330, th = Math.round(tw * H / W);
    const thumbs = [];
    for (let i = 0; i < cfg.n; i++) {
      const file = path.join(out, `${String(i + 1).padStart(2, '0')}-${cfg.names[i]}.png`);
      await sharp(strip).extract({ left: i * W, top: 0, width: W, height: H })
        .removeAlpha().toColourspace('srgb').png().toFile(file);
      const m = await sharp(file).metadata();
      if (m.width !== W || m.height !== H || m.hasAlpha) throw new Error('Bad output ' + file);
      thumbs.push({ input: await sharp(file).resize(tw, th).toBuffer(), left: 40 + i * (tw + 16), top: 40 });
      console.log(`${path.basename(file)}  ${W}x${H}`);
    }
    const bg = await p.evaluate(() => getComputedStyle(document.body).getPropertyValue('--sheet').trim() || '#dddddd');
    await sharp({ create: { width: 64 + cfg.n * (tw + 16), height: th + 80, channels: 3, background: bg } })
      .composite(thumbs).png().toFile(path.join(dir, `${path.basename(dir)}-overview.png`));
    await p.close();
  }
  await browser.close();
})().catch(e => { console.error(e.message || e); process.exit(1); });
