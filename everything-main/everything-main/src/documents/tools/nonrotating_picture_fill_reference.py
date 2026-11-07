"""Record independent reference PDF color samples, excluding antialiased edges."""
from pathlib import Path
from zipfile import ZipFile
import hashlib
import json
import sys
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'tests/fixtures/nonrotating-picture-fill/controls.docx'
COLORS = [(240,40,30), (30,80,210), (40,170,70), (240,180,20), (255,255,255)]


def record(native_source, pdf_path, kind='standalone'):
    source = SOURCE.with_name('grouped.docx') if kind == 'grouped' else SOURCE
    with ZipFile(source) as current, ZipFile(native_source) as native:
        body = current.read('word/document.xml')
        assert body == native.read('word/document.xml'), 'Native reference has different document XML'
        for name in current.namelist():
            if name.startswith('word/media/'):
                assert current.read(name) == native.read(name), name
    pdf = pdfium.PdfDocument(pdf_path)
    assert len(pdf) == (8 if kind == 'grouped' else 12)
    pages = []
    for page in pdf:
        image = page.render(scale=4/3).to_pil().convert('RGB')
        assert image.size == ((816,1056) if kind == 'grouped' else (672,672))
        width,height=image.size
        pixels = image.load()
        samples = []
        for y in range(128,height-47,16):
            for x in range(80,width-31,16):
                color = pixels[x,y]
                if color in COLORS and all(pixels[x+dx,y+dy] == color
                        for dx in range(-4,5) for dy in range(-4,5)):
                    samples.append([x,y,COLORS.index(color)])
        bounds = []
        for color in COLORS[:4]:
            points = [(x,y) for y in range(120,height) for x in range(width) if pixels[x,y] == color]
            bounds.append([min(x for x,y in points), min(y for x,y in points),
                           max(x for x,y in points)+1, max(y for x,y in points)+1])
        pages.append({'samples': samples, 'bounds': bounds})
    result = {'referenceBuild': '16.0.20326', 'documentXmlSha256': hashlib.sha256(body).hexdigest(),
              'pdfSha256': hashlib.sha256(Path(pdf_path).read_bytes()).hexdigest(),
              'pagePixels': [width,height], 'colors': COLORS, 'pages': pages}
    target = source.with_name('grouped-native.json' if kind == 'grouped' else 'native.json')
    target.write_text(json.dumps(result, separators=(',',':'))+'\n', encoding='utf-8')
    print(f'{len(pages)} pages; {sum(len(p["samples"]) for p in pages)} native samples: {target}')


if __name__ == '__main__':
    record(*sys.argv[1:])
