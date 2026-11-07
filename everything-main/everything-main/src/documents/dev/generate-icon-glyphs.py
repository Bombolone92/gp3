"""Outline the letters the command icons draw (src/ui/command-icons.js) so an icon carries paths rather
than SVG text (which would leak into textContent and depend on the fonts installed). The faces are the
spreadsheet's Apache-2.0 Open Sans and Caladea (src/spreadsheet/public/fonts), the same ones its icons
use, so the commands the two apps share draw identical lettering.
Run: python3 dev/generate-icon-glyphs.py  (needs fontTools)"""
import json, re, pathlib
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

root = pathlib.Path(__file__).resolve().parent.parent
source = (root / 'src/ui/command-icons.js').read_text()
fonts = root.parent / 'spreadsheet/public/fonts'
FONTS = {
    'sans': fonts / 'opensans/OpenSans-Regular.ttf',
    'sansBold': fonts / 'opensans/OpenSans-Bold.ttf',
    'serif': fonts / 'caladea/Caladea-Regular.ttf',
    'serifItalic': fonts / 'caladea/Caladea-Italic.ttf',
}
need = {k: set() for k in FONTS}
for m in re.finditer(r"\bt\([^,]+,[^,]+,\s*'([^']*)',\s*[\d.]+(?:,\s*\{([^}]*)\})?", source):
    text, opts = m.group(1), m.group(2) or ''
    serif = 'serif: true' in opts
    italic = 'italic: true' in opts
    bold = re.search(r'weight:\s*[67]00', opts) is not None
    variant = ('serifItalic' if italic else 'serif') if serif else ('sansBold' if bold else 'sans')
    need[variant].update(text)
# numberedLines() draws its labels in bold; the sort icons letter A and Z.
need['sansBold'].update('123aAZ')
need['sans'].update('AZ')
out = {}
for variant, path in FONTS.items():
    font = TTFont(path)
    upm = font['head'].unitsPerEm
    cmap = font.getBestCmap()
    glyphs = font.getGlyphSet()
    table = {}
    for ch in sorted(need[variant]):
        name = cmap.get(ord(ch))
        if name is None:
            raise SystemExit(f'{path} has no glyph for {ch!r}')
        pen = SVGPathPen(glyphs)
        # Thousandths of an em, y down, baseline at 0.
        glyphs[name].draw(TransformPen(pen, (1000 / upm, 0, 0, -1000 / upm, 0, 0)))
        table[ch] = [round(glyphs[name].width * 1000 / upm), re.sub(r'-?\d+\.\d+', lambda n: str(round(float(n.group()))), pen.getCommands())]
    out[variant] = table
js = ('/** The outlines of the letters the command icons draw, in thousandths of an em, baseline at 0: from the\n'
      ' * spreadsheet\'s bundled Open Sans and Caladea fonts (Apache-2.0), so lettering the two apps share draws the\n'
      ' * same. Regenerate with dev/generate-icon-glyphs.py. */\n'
      f'export const ICON_GLYPHS = {json.dumps(out, ensure_ascii=False, separators=(",", ":"))};\n')
(root / 'src/ui/icon-glyphs.js').write_text(js)
print({k: ''.join(sorted(v)) for k, v in need.items()}, len(js))
