"""Verify independent reference captures and record mixed-run prefix positions."""
from pathlib import Path
import hashlib
import json
from pypdf import PdfReader

FOLDER = Path(__file__).resolve().parents[1] / 'tests/fixtures/script-kerning-defaults'
IDENTITIES = {
    'Garamond': ['Garamond', 'Garamond-Bold', 'Garamond-Italic'],
    'Arial': ['ArialMT', 'Arial-BoldMT', 'Arial-ItalicMT'],
    'Times New Roman': ['TimesNewRomanPSMT', 'TimesNewRomanPS-BoldMT', 'TimesNewRomanPS-ItalicMT'],
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    references = []
    for case in json.loads((FOLDER / 'cases.json').read_text()):
        name = case['name']
        record = json.loads((FOLDER / f'{name}-native.json').read_text(encoding='utf-8-sig'))
        assert digest(FOLDER / f'{name}.docx') == record['sourceSha256']
        pdf = FOLDER / f'{name}-native.pdf'
        assert digest(pdf) == record['pdfSha256']
        reader = PdfReader(pdf)
        assert len(reader.pages) == 1
        runs = []

        def visit(text, ctm, matrix, font, size):
            if text.strip() in ['START', 'TEST', 'END']:
                assert ctm == [1, 0, 0, 1, 0, 0] and matrix[:4] == [1, 0, 0, 1]
                runs.append(dict(text=text.strip(), font=str(font['/BaseFont']).split('+')[-1],
                                 size=size, x=matrix[4], y=matrix[5]))

        reader.pages[0].extract_text(visitor_text=visit)
        assert len(runs) == len(case['rows']) * 3 == 81
        for i, (row, native) in enumerate(zip(case['rows'], record['rows'], strict=True)):
            assert all(row[key] == native[key] for key in ['family', 'face', 'kern'])
            start, script, end = runs[i * 3:i * 3 + 3]
            expected = IDENTITIES[row['family']][['regular', 'bold', 'italic'].index(row['face'])]
            assert [r['text'] for r in [start, script, end]] == ['START', 'TEST', 'END']
            assert all(r['font'] == expected for r in [start, script, end])
            assert start['size'] == end['size'] and abs(start['size'] - row['size']) < .061
            row.update(native, nativeSize=script['size'], scriptX=script['x'], followingX=end['x'],
                       prefixX=start['x'], rise=script['y'] - start['y'], font=expected)
        references.append(dict(case, version=record['version'], build=record['build'],
                               sourceSha256=record['sourceSha256'], pdfSha256=record['pdfSha256']))
    (FOLDER / 'reference.json').write_text(json.dumps(references, indent=2) + '\n')
    for case in references:
        print(case['name'], [(r['family'], r['face'], r['kern'], r['nativeKerning'], r['scriptX']) for r in case['rows']])


if __name__ == '__main__':
    main()
