"""Extract native reference path and raster bounds; never reads engine output."""
from pathlib import Path
import hashlib
import json
from pypdf import PdfReader
from pypdf.generic import ContentStream
import pypdfium2 as pdfium

DIRECTORY = Path(__file__).resolve().parents[1] / 'tests/fixtures/relative-anchor-effects'


def record(name, pdf_name):
    source, pdf = DIRECTORY / (name + '.docx'), DIRECTORY / pdf_name
    page = PdfReader(pdf).pages[0]
    paths, points, red = [], [], False
    for args, op in ContentStream(page.get_contents(), page.pdf).operations:
        if op == b'RG':
            red = all(abs(float(v) - target) < .002 for v, target in zip(args, [220/255, 32/255, 64/255]))
        if op == b're':
            x, y, w, h = map(float, args)
            points = [(x, y), (x + w, y + h)]
        elif op in [b'm', b'l', b'c']:
            if op == b'm':
                points = []
            points.extend(zip(map(float, args[::2]), map(float, args[1::2])))
        elif op in [b'S', b's', b'B', b'B*', b'b', b'b*']:
            if red and points:
                xs, ys = zip(*points)
                paths.append(dict(x=min(xs), y=float(page.mediabox.height)-max(ys), width=max(xs)-min(xs), height=max(ys)-min(ys)))
            points = []
        elif op in [b'n', b'f', b'f*']:
            points = []
    assert len(paths) == 8, paths
    document = pdfium.PdfDocument(pdf)
    raster = document[0].render(scale=4/3).to_pil().convert('RGB')
    pixels = list(raster.getdata())
    bands = []
    for left, right in [(0, 408), (408, 816)]:
        column = []
        for y in range(raster.height):
            xs = [x for x in range(left, right) if (lambda c: c[0] > 170 and c[0] > c[1] + 80 and c[0] > c[2] + 80)(pixels[y*raster.width+x])]
            if not xs:
                continue
            if column and column[-1][3] + 1 == y:
                box = column[-1]
                box[0], box[2], box[3] = min(box[0], min(xs)), max(box[2], max(xs)), y
            else:
                column.append([min(xs), y, max(xs), y])
        assert len(column) == 4, column
        bands.extend(column)
    document.close()
    return dict(name=name, referenceVersion='16.0.20326', sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(), pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(), paths=paths, inkBounds=bands)


if __name__ == '__main__':
    result = [record('source', 'native.pdf'), record('cell', 'cell-native.pdf')]
    (DIRECTORY / 'reference.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
