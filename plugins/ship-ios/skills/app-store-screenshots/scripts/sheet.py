#!/usr/bin/env python3
"""Labeled contact sheets, for looking at many screenshots in one image.

  sheet.py grid OUT.png [--cols 8] [--width 260] FILE...
      One tile per file, file name above each. Use it to survey source captures.

  sheet.py compare OUT.png LABEL=DIR [LABEL=DIR ...]
      One row per directory of PNGs, sorted by name. Use it for old-vs-new.

Needs Pillow.
"""
import argparse, glob, os, sys
from PIL import Image, ImageDraw, ImageFont

def font(size):
    for p in ('/System/Library/Fonts/Helvetica.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def grid(out, files, cols, width):
    ims = []
    for f in files:
        try:
            im = Image.open(f).convert('RGB')
        except Exception:
            continue
        ims.append((os.path.basename(f), im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)))
    if not ims:
        sys.exit('no readable images')
    h = max(i.height for _, i in ims) + 22
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (width + 8) + 8, rows * (h + 8) + 8), '#888')
    d, f = ImageDraw.Draw(sheet), font(13)
    for k, (name, im) in enumerate(ims):
        x, y = 8 + (k % cols) * (width + 8), 8 + (k // cols) * (h + 8)
        sheet.paste(im, (x, y + 20))
        d.text((x, y + 3), name[:40], fill='white', font=f)
    sheet.save(out)

def compare(out, pairs):
    rows = []
    for p in pairs:
        label, _, d = p.partition('=')
        rows.append((label, sorted(glob.glob(os.path.join(os.path.expanduser(d), '*.png')))))
    first = Image.open(next(f for _, fs in rows for f in fs))
    W = 330; H = round(first.height * W / first.width)
    n = max(len(fs) for _, fs in rows)
    sheet = Image.new('RGB', (40 + n * (W + 16) + 24, len(rows) * (H + 80) + 40), '#e4e2dc')
    d, f = ImageDraw.Draw(sheet), font(34)
    for r, (label, fs) in enumerate(rows):
        y = 40 + r * (H + 80)
        d.text((40, y), label, fill='#222', font=f)
        for i, p in enumerate(fs):
            sheet.paste(Image.open(p).convert('RGB').resize((W, H), Image.LANCZOS), (40 + i * (W + 16), y + 50))
    sheet.save(out)

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('mode', choices=['grid', 'compare'])
    ap.add_argument('out')
    ap.add_argument('items', nargs='+')
    ap.add_argument('--cols', type=int, default=8)
    ap.add_argument('--width', type=int, default=260)
    a = ap.parse_args()
    grid(a.out, a.items, a.cols, a.width) if a.mode == 'grid' else compare(a.out, a.items)
    print(a.out)
