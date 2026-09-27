#!/usr/bin/env python3
"""Build an exact-geometry proof sheet for a family of literal SVG/TSX outline icons.

    proof.py --out /tmp/icon-proof.html icons/*.svg
    proof.py --out /tmp/icon-proof.html src/components/icons/*.tsx
    proof.py --out p.html --stroke-width 2 --sizes 20,24,32 --colors '#999,#333' --bg '#fff' icons/*.svg

Every file must match the family contract (viewBox, stroke, caps, joins, no fill)
and hold only literal <path d> children. Anything else is rejected, not skipped.
The sheet shows each icon at real CSS sizes, in each colour, side by side, so
neighbours can be compared at the size they ship at."""
import argparse
import html
from pathlib import Path
import re
import xml.etree.ElementTree as ET

EXPECTED = {
    'viewBox': '0 0 24 24', 'fill': 'none', 'stroke': 'currentColor',
    'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
}
ALIASES = {'strokeWidth': 'stroke-width', 'strokeLinecap': 'stroke-linecap',
           'strokeLinejoin': 'stroke-linejoin'}
SIZES = (26, 34, 40)
COLORS = ('#D4D4CF', '#A3A39E')
BACKGROUND = '#F5F5F0'
ATTR = re.compile(r'([\w:-]+)\s*=\s*(?:"([^"]*)"|\{([^{}]*)\})')


def attributes(raw):
    attrs = {}
    for match in ATTR.finditer(raw):
        name = ALIASES.get(match[1], match[1])
        if name in attrs:
            raise ValueError(f'duplicate attribute {name}')
        attrs[name] = match[2] if match[2] is not None else '{' + match[3] + '}'
    if ATTR.sub('', raw).strip():
        raise ValueError('unsupported JSX attributes; use literal paths and the supplied template')
    return attrs


def check_wrapper(attrs, tsx=False):
    extras = set(attrs) - set(EXPECTED) - {'xmlns', 'width', 'height', 'color', 'accessible', 'aria-hidden', 'role'}
    if extras:
        raise ValueError(f'unsupported SVG attributes: {sorted(extras)}')
    for key, expected in EXPECTED.items():
        actual = attrs.get(key)
        if key == 'stroke-width' and tsx and actual == '{' + expected + '}':
            actual = expected
        if actual != expected:
            raise ValueError(f'{key} must be {expected!r}, found {actual!r}; pass --viewbox or --stroke-width if the family uses another value')
    if tsx:
        for key, expected in {'width': '{size}', 'height': '{size}', 'color': '{color}'}.items():
            if attrs.get(key) != expected:
                raise ValueError(f'TSX {key} must be {expected}')


def read_paths(file):
    source = file.read_text()
    if file.suffix.lower() == '.tsx':
        roots = list(re.finditer(r'<Svg\b([^>]*)>(.*?)</Svg>', source, re.S))
        if len(roots) != 1:
            raise ValueError('expected exactly one Svg root')
        check_wrapper(attributes(roots[0][1]), tsx=True)
        body = roots[0][2]
        children = list(re.finditer(r'<Path\b([^>]*)/>', body, re.S))
        if re.sub(r'<Path\b[^>]*/>', '', body, flags=re.S).strip():
            raise ValueError('only literal Path children are supported; render other JSX in the app')
        paths = []
        for child in children:
            attrs = attributes(child[1])
            if set(attrs) != {'d'}:
                raise ValueError('Path must contain only a literal d attribute')
            paths.append(attrs['d'])
    elif file.suffix.lower() == '.svg':
        if '<!DOCTYPE' in source.upper() or '<!ENTITY' in source.upper():
            raise ValueError('external declarations are not supported')
        root = ET.fromstring(source)
        if root.tag not in ('svg', '{http://www.w3.org/2000/svg}svg'):
            raise ValueError('expected an SVG root')
        check_wrapper(root.attrib)
        paths = []
        for child in root:
            if child.tag not in ('path', '{http://www.w3.org/2000/svg}path') or set(child.attrib) != {'d'} or len(child):
                raise ValueError('only path elements with a d attribute are supported')
            if (child.text or '').strip() or (child.tail or '').strip():
                raise ValueError('unexpected text content')
            paths.append(child.attrib['d'])
        if (root.text or '').strip():
            raise ValueError('unexpected text content')
    else:
        raise ValueError('input must be .svg or .tsx')
    if not paths:
        raise ValueError('no paths found')
    for d in paths:
        if not re.fullmatch(r'[Mm][MmZzLlHhVvCcSsQqTtAa0-9eE.,+\s-]+', d.strip()):
            raise ValueError('path must be literal SVG path data beginning with M')
    return paths


def svg(paths, size, color):
    attrs = ' '.join(f'{k}="{v}"' for k, v in EXPECTED.items())
    children = ''.join(f'<path d="{html.escape(d, quote=True)}"/>' for d in paths)
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" color="{color}" {attrs} aria-hidden="true">{children}</svg>'


def main():
    global SIZES, COLORS
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('inputs', nargs='+', type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--title', default='Icon proof')
    parser.add_argument('--viewbox', default=EXPECTED['viewBox'], help='family viewBox, default "0 0 24 24"')
    parser.add_argument('--stroke-width', default=EXPECTED['stroke-width'], help='family stroke width, default 1.5')
    parser.add_argument('--sizes', default=','.join(map(str, SIZES)), help='CSS px sizes, smallest first')
    parser.add_argument('--colors', default=','.join(COLORS), help='stroke colours, e.g. the placeholder and active colour')
    parser.add_argument('--bg', default=BACKGROUND, help='background colour of the surface the icons sit on')
    args = parser.parse_args()
    EXPECTED['viewBox'] = args.viewbox
    EXPECTED['stroke-width'] = args.stroke_width
    SIZES = tuple(int(x) for x in args.sizes.split(','))
    COLORS = tuple(c.strip() for c in args.colors.split(','))
    if args.out.resolve() in [p.resolve() for p in args.inputs]:
        parser.error('output must not overwrite an input')
    glyphs = []
    for file in args.inputs:
        try:
            glyphs.append((file.stem, read_paths(file)))
        except (ValueError, OSError, ET.ParseError) as error:
            parser.error(f'{file}: {error}')
    headings = ''.join(f'<th>{size} px</th>' for _ in COLORS for size in SIZES)
    color_heads = ''.join(f'<th colspan="{len(SIZES)}">{html.escape(c)}</th>' for c in COLORS)
    per = len(SIZES) * len(COLORS)
    title = html.escape(args.title)
    bg = html.escape(args.bg)
    rows = ''.join('<tr><th scope="row">' + html.escape(name) + '</th>' + ''.join(
        '<td>' + svg(paths, size, color) + '</td>' for color in COLORS for size in SIZES
    ) + '</tr>' for name, paths in glyphs)
    document = f'''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title>
<style>*{{box-sizing:border-box}}body{{margin:0;padding:40px;background:{bg};color:#1A2B44;font:14px system-ui,sans-serif}}main{{max-width:960px;margin:auto}}h1{{font:32px Georgia,serif}}p{{font-size:12px;color:#737370}}table{{width:100%;border-collapse:collapse;table-layout:fixed}}th{{font-weight:400;font-size:12px}}thead th{{padding:12px}}td,tbody th{{height:58px;border-bottom:1px solid rgba(0,0,0,.08);text-align:center}}tbody th{{text-align:left;overflow-wrap:anywhere}}svg{{vertical-align:middle}}footer{{margin-top:24px;font-size:11px;color:#737370}}</style>
<main><h1>{title}</h1><p>Actual CSS sizes · viewBox {html.escape(EXPECTED['viewBox'])} · stroke {html.escape(EXPECTED['stroke-width'])}</p>
<table><thead><tr><th>Icon</th>{color_heads}</tr><tr><th></th>{headings}</tr></thead><tbody>{rows}</tbody></table>
<footer>{len(glyphs)} icons · {len(glyphs) * per} specimens. Geometry extracted from source; a browser proof is not native-device validation.</footer></main></html>'''
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(document)
    print(f'{args.out}: {len(glyphs)} icons, {len(glyphs) * per} specimens')


if __name__ == '__main__':
    main()
