"""Hash-bound reference glyph geometry for the independently authored EMF controls."""
from pathlib import Path
from hashlib import sha256
import json, sys
import pypdfium2 as pdfium
ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[2]) if len(sys.argv)>2 else ROOT / 'tests/fixtures/metafile-file-fonts'
path = Path(sys.argv[1])
pdf = pdfium.PdfDocument(path)
assert len(pdf) == 1
page = pdf[0]; text = page.get_textpage(); height = page.get_height()
chars = []; started = False
for i in range(text.count_chars()):
    value = text.get_text_range(i, 1)
    if value == 'A': started = True
    if not started or value.isspace(): continue
    left, bottom, right, top = text.get_charbox(i)
    chars.append(dict(text=value, left=left, top=height-top, right=right, bottom=height-bottom))
assert ''.join(c['text'] for c in chars) == 'Ab&Ω' * 8
cases = json.loads((ROOT / 'tests/fixtures/emf-text/cases.json').read_text())
for i, case in enumerate(cases): case['glyphs'] = chars[i*4:i*4+4]
if len(sys.argv)>3 and sys.argv[3]=='--pixel-bounds':
    import math
    scale=16/3
    image=page.render(scale=scale).to_pil().convert('RGB')
    for case in cases:
        glyphs=case['glyphs'];left=min(g['left'] for g in glyphs);right=max(g['right'] for g in glyphs);top=min(g['top'] for g in glyphs);bottom=max(g['bottom'] for g in glyphs)
        xs=[];ys=[]
        for y in range(math.floor((top-6)*scale),math.ceil((bottom+6)*scale)):
            for x in range(math.floor((left-6)*scale),math.ceil((right+6)*scale)):
                r,g,b=image.getpixel((x,y))
                if b>r+20 and r<180:xs.append(x);ys.append(y)
        assert xs and ys
        case['ink']={'left':min(xs)/scale,'right':(max(xs)+1)/scale,'top':min(ys)/scale,'bottom':(max(ys)+1)/scale}
data = dict(referenceVersion='16.0.20326', sourceSha256=sha256((OUT/'control.docx').read_bytes()).hexdigest(), pdfSha256=sha256(path.read_bytes()).hexdigest(), cases=cases)
(OUT/'reference.json').write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
page.render(scale=4/3).to_pil().save(OUT/'native.png')
