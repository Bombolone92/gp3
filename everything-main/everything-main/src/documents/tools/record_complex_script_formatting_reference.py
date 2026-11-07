"""Record native glyph font, origin and transform (including synthetic italics)."""
from pathlib import Path
from hashlib import sha256
import ctypes
import json
import math
import pypdfium2 as P
import pypdfium2.raw as R
from PIL import Image

root = Path(__file__).resolve().parents[1]/'tests/fixtures/complex-script-formatting'
pdf = P.PdfDocument(root/'native.pdf')
pages, samples = [], []
cases = json.loads((root/'cases.json').read_text(encoding='utf-8'))
tiles = Image.new('RGB', (600, 128 * 6), 'white')
for page in pdf:
    text = page.get_textpage()
    chars = []
    for i in range(text.count_chars()):
        code = R.FPDFText_GetUnicode(text, i)
        if code < 32:
            continue
        x, y = ctypes.c_double(), ctypes.c_double()
        assert R.FPDFText_GetCharOrigin(text, i, ctypes.byref(x), ctypes.byref(y))
        font, flags, matrix = ctypes.create_string_buffer(256), ctypes.c_int(), R.FS_MATRIX()
        R.FPDFText_GetFontInfo(text, i, font, 256, ctypes.byref(flags))
        assert R.FPDFText_GetMatrix(text, i, ctypes.byref(matrix))
        # PDFium synthesizes spaces between text objects; they have no font.
        if not font.value:
            continue
        left, bottom, right, top = text.get_charbox(i)
        chars.append(dict(text=chr(code), x=x.value, y=page.get_height()-y.value,
            font=font.value.decode(), size=R.FPDFText_GetFontSize(text, i),
            weight=R.FPDFText_GetFontWeight(text, i),
            box=[left, page.get_height()-top, right, page.get_height()-bottom],
            matrix=[getattr(matrix, key) for key in ('a','b','c','d')]))
    raster = page.render(scale=4).to_pil().convert('RGB')
    baselines = sorted(set(round(c['y'], 2) for c in chars))
    for local in range(6):
        index = len(pages)*6+local
        baseline = baselines[local*2+1]
        glyphs = [c for c in chars if abs(c['y']-baseline)<.02 and c['text'] in 'ABC']
        assert ''.join(c['text'] for c in glyphs) == 'ABC'
        origin_x, origin_y = round(glyphs[0]['x']*4)-16, round(glyphs[0]['y']*4)-100
        # Isolate only this word, leaving adjacent numbers outside the tile.
        box = [math.floor(min(c['box'][0] for c in glyphs)*4)-1,
               math.floor(min(c['box'][1] for c in glyphs)*4)-1,
               math.ceil(max(c['box'][2] for c in glyphs)*4)+1,
               math.ceil(max(c['box'][3] for c in glyphs)*4)+1]
        tile_x, tile_y = index%3*200, index//3*128
        tiles.paste(raster.crop(box), (tile_x+box[0]-origin_x, tile_y+box[1]-origin_y))
        samples.append(dict(index=index, tile=[tile_x,tile_y,200,128],
            origin=[glyphs[0]['x']*4-origin_x,glyphs[0]['y']*4-origin_y],
            glyphs=glyphs))
    pages.append(chars)
tiles.save(root/'native-abc.png')
assert len(samples) == len(cases)
result = dict(referenceVersion='16.0.20326', pages=pages, samples=samples, rasterScale=4)
for name, key in [('control.docx','sourceSha256'), ('native.pdf','pdfSha256'), ('cases.json','casesSha256')]:
    result[key] = sha256((root/name).read_bytes()).hexdigest()
result['rasterSha256'] = sha256((root/'native-abc.png').read_bytes()).hexdigest()
(root/'reference.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
