"""Compare PDF glyph metadata with independently verified tracking controls.

Reads glyph origins and declared PDF text sizes only; does not extract embedded
font programs or certify native raster fidelity.
"""
import argparse
import ctypes
import hashlib
import json
from pathlib import Path
import pypdfium2 as pdf

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/fixtures/installed-tracking-origins'
COMPARISON = ROOT / 'docs/evidence/installed-tracking-origins-2026-10-02.json'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()


def audit(pdf_path, output):
    reference = json.loads((FIXTURE / 'reference.json').read_text())
    comparison = json.loads(COMPARISON.read_text())
    assert reference['sourceSha256'] == comparison['sourceSha256'] == sha(FIXTURE / 'control.docx')
    assert reference['casesSha256'] == sha(FIXTURE / 'cases.json')
    for case in reference['cases']:
        assert case['captureSha256'] == sha(FIXTURE / f"page-{case['page'] + 1}.emf")
    rows = []
    with pdf.PdfDocument(pdf_path) as document:
        assert len(document) == 27
        for case, page in zip(reference['cases'], document, strict=True):
            assert page.get_size() == (612, 792)
            textpage = page.get_textpage()
            chars = [textpage.get_text_range(i, 1) for i in range(textpage.count_chars())]
            assert all(len(ch) == 1 for ch in chars)
            joined = ''.join(chars)
            for native in case['origins']:
                label = native['text']
                start = joined.find(label)
                assert start >= 0 and joined.find(label, start + 1) == -1
                matches = [r for r in comparison['comparison'] if r['page'] == case['page'] and r['text'] == label]
                assert len(matches) == 1 and matches[0]['differentPixels'] == 0
                actual = matches[0]
                pdf_x, sizes = [], []
                for i in range(len(label)):
                    x, y = ctypes.c_double(), ctypes.c_double()
                    assert pdf.raw.FPDFText_GetCharOrigin(textpage, start + i, ctypes.byref(x), ctypes.byref(y))
                    sizes.append(pdf.raw.FPDFText_GetFontSize(textpage, start + i))
                    pdf_x.append(x.value)
                assert max(sizes) - min(sizes) < 1e-6
                emf_pdf = [a - b for a, b in zip(native['glyphsPt'], pdf_x, strict=True)]
                app_pdf = [a + error - b for a, error, b in zip(native['glyphsPt'], actual['errorsPt'], pdf_x, strict=True)]
                rows.append(dict(page=case['page'], family=case['family'], authoredSizePt=case['size'],
                                 pdfSizePt=sizes[0], trackingPt=case['trackingPt'], text=label,
                                 maxEmfPdfPt=max(map(abs, emf_pdf)), maxAppPdfPt=max(map(abs, app_pdf)),
                                 emfPdfPt=emf_pdf, appPdfPt=app_pdf))
            textpage.close()
            page.close()
    result = dict(scope=__doc__.strip(), pdfSha256=sha(pdf_path), sourceSha256=reference['sourceSha256'],
                  comparisonSha256=sha(COMPARISON), rows=rows)
    output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(dict(rows=len(rows), differingFontSizes=sum(abs(r['pdfSizePt'] - r['authoredSizePt']) > .001 for r in rows),
                         maxEmfPdfPt=max(r['maxEmfPdfPt'] for r in rows), maxAppPdfPt=max(r['maxAppPdfPt'] for r in rows)), indent=2))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    audit(args.pdf, args.output)
