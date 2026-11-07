"""Extract reference PDF measurements independently of the editor (requires pypdf).

Export each original continuation DOCX from the reference application as <fixture>-native.pdf, then run:
  python tools/measure_native_continuation.py PDF_DIRECTORY OUTPUT_DIRECTORY
The resulting values come solely from PDF text matrices and painted rectangles.
"""
from pathlib import Path
import argparse
import json
from pypdf import PdfReader
from pypdf.generic import ContentStream
from continuation_border_fixtures import fixtures
from continuation_heading_fixtures import fixtures as heading_fixtures
from continuation_exact_fixtures import fixtures as exact_fixtures

def rectangles(page, reader):
    color, stack, pending, result = None, [], [], []
    for args, op in ContentStream(page.get_contents(), reader).operations:
        if op == b'q': stack.append(color)
        elif op == b'Q': color = stack.pop() if stack else None
        elif op == b'rg': color = tuple(float(value) for value in args)
        elif op == b're': pending.append(tuple(float(value) for value in args))
        elif op in [b'f', b'f*', b'B', b'B*']:
            if color and color[2] > .5:
                for x, y, width, height in pending:
                    top = float(page.mediabox.height) - y - height
                    result.append(dict(x=x, top=top, width=width, height=height))
            pending = []
        elif op in [b'n', b'S', b's']: pending = []
    return result

def horizontal(rects):
    result = [{**edge, 'top': round(edge['top'], 3)} for edge in rects if edge['width'] > 40 and 0 < edge['height'] < 5]
    return sorted(result, key=lambda edge: (edge['top'], edge['x']))

def vertical(rects):
    groups = {}
    # Include small corner rectangles: omitting them shortens visible endpoints.
    for edge in rects:
        if not (0 < edge['width'] < 5 and edge['height'] > 0): continue
        key = round(edge['x'], 2)
        rectangle = dict(x=edge['x'], top=edge['top'], width=edge['width'], bottom=edge['top'] + edge['height'])
        if key not in groups: groups[key] = rectangle
        groups[key]['top'] = min(groups[key]['top'], rectangle['top'])
        groups[key]['bottom'] = max(groups[key]['bottom'], rectangle['bottom'])
    return sorted(groups.values(), key=lambda edge: edge['x'])

def measure(folder, output):
    lines, mixed, direct, verticals, headings, exact = {}, {}, {}, {}, {}, {}
    for name in sorted([*fixtures(), *heading_fixtures(), *exact_fixtures()]):
        reader = PdfReader(folder / (name + '-native.pdf'))
        text = []
        for index, page in enumerate(reader.pages):
            def visit(value, cm, tm, font, size):
                for label in value.splitlines():
                    if label.strip(): text.append(dict(text=label.strip(), page=index, baseline=float(page.mediabox.height) - tm[5]))
            page.extract_text(visitor_text=visit)
        if name.startswith('continuation-small-exact-'):
            exact[name] = dict(pages=len(reader.pages), lines=text, ink=[rectangles(page, reader) for page in reader.pages])
        elif name.startswith('continuation-keep-heading-'):
            headings[name + '-native.pdf'] = [dict(page=index, text=page.extract_text()) for index, page in enumerate(reader.pages)]
        else: lines[name] = dict(pages=len(reader.pages), lines=text)
        if name.startswith('continuation-mixed-border-'):
            ink = horizontal(rectangles(reader.pages[1], reader))
            first = next((edge for edge in ink if abs(edge['top'] - 72) < .1), None)
            mixed[name] = {key: first[key] for key in ['top', 'height', 'width']} if first else None
        if name.startswith('continuation-direct-'):
            pages = [rectangles(page, reader) for page in reader.pages]
            direct[name] = [horizontal(page) for page in pages]
            verticals[name] = [vertical(page) for page in pages]
    output.mkdir(parents=True, exist_ok=True)
    for filename, data in [('native-lines.json', lines), ('native-mixed-ink.json', mixed), ('native-direct-ink.json', direct), ('native-vertical-ink.json', verticals), ('native-heading-pages.json', headings), ('native-small-exact.json', exact)]:
        (output / filename).write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf_directory', type=Path)
    parser.add_argument('output_directory', type=Path)
    args = parser.parse_args()
    measure(args.pdf_directory, args.output_directory)
