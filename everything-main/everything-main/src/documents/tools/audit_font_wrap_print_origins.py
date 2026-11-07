"""Compare independently captured reference wrap widths and printed Latin origins.

Read-only inspection: no font files are copied or document references updated.
Requires an installed Arial font, fontTools, lxml and pypdfium2.
"""
import argparse
import ctypes
import hashlib
import json
import math
from pathlib import Path
from zipfile import ZipFile

from fontTools.ttLib import TTFont
from lxml import etree
import pypdfium2 as pdf


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit(fixture, font_path):
    reference = json.loads((fixture / 'reference.json').read_text())
    thresholds = json.loads((fixture / 'native-width-thresholds.json').read_text())
    for name, expected in reference['hashes'].items():
        assert sha(fixture / name) == expected, f'Changed reference: {name}'
    assert thresholds['sourceSha256'] == reference['hashes']['control.docx']
    with TTFont(font_path) as font:
        cmap = font.getBestCmap()
        em = font['head'].unitsPerEm
        advances = {c: font['hmtx'][cmap[ord(c)]][0] for c in 'M '}
    with ZipFile(fixture / 'control.docx') as package:
        xml = etree.fromstring(package.read('word/document.xml'))
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    attr = '{' + ns['w'] + '}'
    paragraphs = xml.findall('w:body/w:p', ns)
    assert len(paragraphs) == len(reference['cases']) == 16
    expected_text = ' '.join(['MMMM'] * 8)
    for paragraph, case in zip(paragraphs, reference['cases']):
        assert ''.join(paragraph.xpath('.//w:t/text()', namespaces=ns)) == expected_text
        props = paragraph.find('w:r/w:rPr', ns)
        assert props.find('w:rFonts', ns).get(attr + 'ascii') == 'Arial'
        assert int(props.find('w:sz', ns).get(attr + 'val')) / 2 == case['size']
        assert props.find('w:spacing', ns).get(attr + 'val') == '20'
        assert props.find('w:kern', ns).get(attr + 'val') == '0'
        spacing = paragraph.find('w:pPr/w:spacing', ns)
        assert spacing.get(attr + 'lineRule') == 'exact'
        assert spacing.get(attr + 'line') == '440'
    # Re-extract origins from the hash-bound PDF rather than trust JSON alone.
    captured = []
    with pdf.PdfDocument(fixture / 'native.pdf') as document:
        assert len(document) == reference['pages'] == 2
        for number, page in enumerate(document):
            text = page.get_textpage()
            try:
                row = None
                for i in range(text.count_chars()):
                    if text.get_text_range(i, 1) != 'M':
                        continue
                    x, y = ctypes.c_double(), ctypes.c_double()
                    assert pdf.raw.FPDFText_GetCharOrigin(text, i, ctypes.byref(x), ctypes.byref(y))
                    baseline = page.get_height() - y.value
                    if row is None or abs(row['baseline'] - baseline) > .1:
                        row = dict(page=number, baseline=baseline, origins=[])
                        captured.append(row)
                    row['origins'].append(x.value)
            finally:
                text.close()
                page.close()
    lines = []
    at = 0
    for case in reference['cases']:
        for line_number, original in enumerate(case['lines']):
            actual = captured[at]
            at += 1
            assert actual['page'] == original['page']
            assert abs(actual['baseline'] - original['baseline']) < 1e-7
            assert actual['origins'] == original['origins']
            # Every wrapped line starts at a whole four-M group in this control.
            assert len(actual['origins']) % 4 == 0
            differences = []
            for i, origin in enumerate(actual['origins']):
                spaces = i // 4
                design = (i * advances['M'] + spaces * advances[' ']) * case['size'] / em
                design += i + spaces  # declared 1pt character spacing
                differences.append(design - (origin - actual['origins'][0]))
            lines.append(dict(size=case['size'], variant=case['variant'], line=line_number,
                              glyphCount=len(differences), printedFontSize=original['fontSize'],
                              lastOriginDesignMinusPrintPt=differences[-1],
                              maxAbsoluteOriginDifferencePt=max(map(abs, differences))))
    assert at == len(captured) == 18
    widths = []
    for case in thresholds['cases']:
        design = (32 * advances['M'] + 7 * advances[' ']) * case['size'] / em + 39
        rounded = math.ceil(design * 20) / 20
        assert abs(rounded - case['minWidth']) < 1e-7, 'Design metrics differ from native threshold'
        widths.append(dict(size=case['size'], designWidthPt=design, nativeMinimumWidthPt=case['minWidth']))
    return dict(sourceHashes=reference['hashes'], referenceJsonSha256=sha(fixture / 'reference.json'),
                thresholdJsonSha256=sha(fixture / 'native-width-thresholds.json'),
                inspectedFontSha256=sha(font_path), unitsPerEm=em, designAdvances=advances,
                nativeWordBuild=thresholds['referenceBuild'], pages=2, paragraphs=16, lines=lines,
                glyphOrigins=sum(row['glyphCount'] for row in lines), widths=widths,
                scope='Declared design advances versus PDF origins and independently measured reference wrap widths; no browser glyph raster comparison or generic output-rounding algorithm is established.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--font', type=Path, default=Path('C:/Windows/Fonts/arial.ttf'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    fixture = Path(__file__).resolve().parents[1] / 'tests/fixtures/font-size-wrap-boundary'
    result = audit(fixture, args.font)
    args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(f"Verified {result['glyphOrigins']} printed M origins, 18 lines, eight native width thresholds")
