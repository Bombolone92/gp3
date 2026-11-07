"""Record text operators from an exact, already-opened reference control export.

The PDF stays local: the metadata reader removes FontFile references before
font construction and never decodes font programs or Type3 glyph programs.
"""
import argparse
import hashlib
import json
from pathlib import Path
from compare_pdf_char_origins import read_metadata_chars


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('state', type=Path, help='Owned-document export state with source hash, reference build, visibility and saved state.')
    parser.add_argument('output', type=Path)
    parser.add_argument('--source', type=Path, help='Independently authored control; defaults to the next-page control.')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    source = args.source or root / 'tests/fixtures/section-floating-tables/separate.docx'
    if args.output.resolve() in {source.resolve(), args.pdf.resolve(), args.state.resolve()}:
        parser.error('Output must differ from all read-only inputs.')
    state = json.loads(args.state.read_text(encoding='utf-8-sig'))
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if state['sourceSha256'] != digest or not all(state.get(key) is True for key in ['sourceUnchanged', 'visible', 'savedBefore', 'savedAfter']):
        raise ValueError('Native source or export ownership/state is unverified.')
    pages = read_metadata_chars(str(args.pdf))
    lines = []
    for number, page in enumerate(pages):
        rows = []
        for char in sorted(page, key=lambda c: (c['y'], c['x'], c['index'])):
            row = next((r for r in rows if abs(r[0]['y'] - char['y']) <= .02), None)
            if row is None:
                row = []
                rows.append(row)
            row.append(char)
        for row in rows:
            row.sort(key=lambda c: (c['x'], c['index']))
            lines.append({'page': number, 'text': ''.join(c['text'] for c in row), 'x': row[0]['x'], 'y': row[0]['y'],
                          'chars': [{key: c[key] for key in ['text', 'x', 'y']} for c in row]})
    result = {'sourceSha256': digest, 'nativePdfSha256': hashlib.sha256(args.pdf.read_bytes()).hexdigest(), 'referenceBuild': state['referenceBuild'],
              'pages': len(pages), 'reader': 'PDF-declared Unicode and text operators; FontFile/FontFile2/FontFile3 excluded before font construction. No program decoding or glyph-map fallback.',
              'method': state['method'], 'sourceUnchanged': True, 'savedStateUnchanged': True, 'lines': lines}
    args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'pages': len(pages), 'lines': len(lines), 'chars': sum(len(line['chars']) for line in lines)}))


if __name__ == '__main__':
    main()
