"""Record explicit PDF text metadata for the original text-advance control.

Font programs remain opaque. Inputs must describe an unchanged, already-open,
visible owned reference control. Nothing is opened, saved or rendered by this tool.
"""
import argparse
import hashlib
import json
from pathlib import Path

from compare_pdf_char_origins import read_metadata_chars
from text_advance_control_fixture import CASES, TEXT


def record(pdf, state_path, output):
    source = Path(__file__).resolve().parents[1] / 'tests/fixtures/text-advance-control/control.docx'
    if output.resolve() in {p.resolve() for p in (source, pdf, state_path)}:
        raise ValueError('Output must differ from every read-only input')
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    state = json.loads(state_path.read_text(encoding='utf-8-sig'))
    if state.get('sourceSha256') != source_hash or not all(
            state.get(key) is True for key in ('sourceUnchanged', 'savedBefore', 'savedAfter', 'visible')):
        raise ValueError('Missing unchanged visible owned source evidence')
    pages = read_metadata_chars(str(pdf))
    if len(pages) != 1:
        raise ValueError('Expected the single-page independent control')
    rows = []
    for char in sorted(pages[0], key=lambda c: (c['y'], c['x'])):
        if not rows or abs(rows[-1][0]['y'] - char['y']) > .02:
            rows.append([])
        rows[-1].append(char)
    expected = ''.join(c for c in TEXT if not c.isspace())
    if len(rows) != len(CASES) or any(''.join(c['text'] for c in row) != expected for row in rows):
        raise ValueError('Native Unicode or line structure differs from the independent control')
    result = dict(sourceSha256=source_hash, pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),
                  referenceBuild=state['referenceBuild'], pages=1, sourceUnchanged=True,
                  savedBefore=True, savedAfter=True, visible=True,
                  method=state['method'], reader='Explicit ToUnicode and PDF text operators; font programs excluded',
                  lines=[dict(family=family, authoredSizePt=size, splitRuns=split,
                              text=expected, chars=row) for (family, size, split), row in zip(CASES, rows)])
    output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('state', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    result = record(args.pdf, args.state, args.output)
    print(json.dumps(dict(sourceSha256=result['sourceSha256'], lines=len(result['lines']),
                          chars=sum(len(line['chars']) for line in result['lines']))))
