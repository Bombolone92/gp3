"""Extract reference geometry from separately exported native reference PDFs.

Usage: python tools/measure_native_row_geometry.py PDF_DIRECTORY OUTPUT_DIRECTORY
Requires pypdf for development only. Does not import or run the document engine.
Text outside a PDF's media box is source evidence, not necessarily visible ink.
"""
import argparse
import json
from pathlib import Path
from pypdf import PdfReader
from pypdf.generic import ContentStream


def lines(page):
    groups = {}
    def visit(text, cm, tm, font, size):
        if text.strip():
            groups.setdefault(round(tm[5], 3), []).append((tm[4], text))
    page.extract_text(visitor_text=visit)
    return [{'text': ''.join(text for x, text in sorted(values)).strip(), 'y': y}
            for y, values in sorted(groups.items(), reverse=True)]


def horizontal_borders(page, reader):
    color, stack, pending, rectangles = None, [], [], []
    for args, op in ContentStream(page.get_contents(), reader).operations:
        if op == b'q': stack.append(color)
        elif op == b'Q': color = stack.pop() if stack else None
        elif op == b'rg': color = tuple(float(value) for value in args)
        elif op == b're': pending.append(tuple(float(value) for value in args))
        elif op in [b'f', b'f*', b'B', b'B*']:
            if color and color[0] == 0 and .52 < color[1] < .54:
                rectangles.extend(pending)
            pending = []
        elif op in [b'n', b'S', b's']: pending = []
    height = float(page.mediabox.height)
    return [dict(top=round(height-y-h, 3), bottom=round(height-y, 3), left=x, width=w)
            for x, y, w, h in rectangles if w > 100 and h < 10]


def red_text_clip(page, reader):
    color, clips, stack, path, found = None, [], [], None, []
    for args, op in ContentStream(page.get_contents(), reader).operations:
        if op == b'q': stack.append((color, clips.copy()))
        elif op == b'Q': color, clips = stack.pop()
        elif op == b'rg': color = tuple(float(value) for value in args)
        elif op == b're': path = tuple(float(value) for value in args)
        elif op in [b'W', b'W*'] and path: clips.append(path)
        elif op in [b'f', b'f*', b'n', b'S']: path = None
        elif op in [b'TJ', b'Tj'] and color == (1., 0., 0.):
            assert clips, 'Red probe text has no explicit PDF clip'
            if clips[-1] not in found: found.append(clips[-1])
    assert len(found) == 1, found
    x, y, w, h = found[0]
    return dict(clip=found[0], topPoints=float(page.mediabox.height)-y-h,
                bottomPoints=float(page.mediabox.height)-y)


def measure(source, output):
    output.mkdir(parents=True, exist_ok=True)
    def write(name, data):
        (output / name).write_text(json.dumps(data, indent=2), encoding='utf-8')
    for kind in ['row-padding', 'row-merge-padding', 'row-mixed-border',
                 'row-exact-border', 'row-border-width', 'row-column-border']:
        records = []
        for page in PdfReader(source / f'{kind}-native.pdf').pages:
            rows = lines(page)
            case = rows[0]['text']
            first = next(row['y'] for row in rows if 'Probe first' in row['text'])
            second = next(row['y'] for row in rows if 'Probe second' in row['text'])
            after = next(row['y'] for row in rows if row['text'] == case + ' after')
            records.append(dict(case=case, heightPoints=round(first-second, 4),
                followingParagraphDeltaPoints=round(second-after, 4),
                firstBaselineDeltaPoints=round(rows[0]['y']-first, 4)))
        write(f'{kind}-native-measurements.json', records)
    for kind in ['row-page-edge', 'row-auto-page-edge', 'row-header-clearance']:
        write(f'{kind}-native-pages.json', [dict(page=i+1, text=page.extract_text())
              for i, page in enumerate(PdfReader(source / f'{kind}-native.pdf').pages)])
    for kind in ['row-repeated-header', 'row-oversized', 'row-oversized-modern',
                 'row-oversized-headers-14', 'row-oversized-headers-15']:
        write(f'{kind}-native-lines.json', [dict(page=i+1, lines=lines(page))
              for i, page in enumerate(PdfReader(source / f'{kind}-native.pdf').pages)])
    reader = PdfReader(source / 'row-clipping-border-native.pdf')
    for kind in ['row-merged-oversized-14', 'row-merged-oversized-15', 'row-merged-later-15', 'row-merged-later-14', 'row-merged-exact-oversized-14', 'row-merged-exact-oversized-15', 'row-merged-exact-later-14', 'row-merged-exact-later-15', 'row-header-threshold-14', 'row-header-threshold-15']:
        write(f'{kind}-native-lines.json', [dict(page=i+1, text=page.extract_text(), lines=lines(page))
              for i, page in enumerate(PdfReader(source / f'{kind}-native.pdf').pages)])
    write('row-clipping-native-measurements.json', [dict(page=i+1, **red_text_clip(page, reader))
          for i, page in enumerate(reader.pages)])
    records = []
    for kind in ['row-oversized-modern', 'row-oversized-short-modern', 'row-oversized-headers-15']:
        reader = PdfReader(source / f'{kind}-native.pdf')
        records.extend(dict(kind=kind, page=i+1, horizontals=horizontal_borders(page, reader))
                       for i, page in enumerate(reader.pages))
    write('row-oversized-border-rectangles.json', records)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf_directory', type=Path)
    parser.add_argument('output_directory', type=Path)
    args = parser.parse_args()
    measure(args.pdf_directory, args.output_directory)
