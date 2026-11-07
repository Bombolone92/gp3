"""Compare a fresh owned reference PDF with a retained rectangle-only reference.

Reads graphics operators and clip scopes only. Never reads font programs or
replaces the retained reference. Native PDFs remain private.
"""
from pathlib import Path
import argparse
import hashlib
import json

from pypdf import PdfReader
from native_rectangle_pdf import rectangle_fills, BLUE


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def geometry_digest(fills):
    return hashlib.sha256(json.dumps(fills, separators=(',', ':')).encode()).hexdigest()


def compare(native_pdf, owned_source, folder):
    reference = json.loads((folder / 'native-print-frames.json').read_bytes())
    assert digest(owned_source) == digest(folder / 'control.docx') == reference['sourceSha256'], 'Source identity changed'
    assert digest(folder / 'native.pdf') == reference['pdfSha256'], 'Reference PDF changed'
    if reference.get('casesSha256'):
        assert digest(folder / 'cases.json') == reference['casesSha256'], 'Case declarations changed'
    native = PdfReader(native_pdf)
    retained = PdfReader(folder / 'native.pdf')
    assert 'Microsoft' in str(native.metadata.producer), 'Expected a native reference PDF export'
    assert len(native.pages) == len(retained.pages) == reference['pageCount'], 'Page count changed'
    pages = []
    for index, (page, previous) in enumerate(zip(native.pages, retained.pages)):
        assert list(page.mediabox) == list(previous.mediabox), 'Paper geometry changed'
        assert not previous['/Resources'].get('/Font'), 'Retained geometry reference contains fonts'
        fresh = rectangle_fills(page, native)
        old = rectangle_fills(previous, retained)
        pages.append(dict(page=index + 1, rectangleFills=len(fresh),
                          blueRectangles=sum(len(rects) for rgb, rects, clips in fresh if rgb == BLUE),
                          freshGeometrySha256=geometry_digest(fresh),
                          retainedGeometrySha256=geometry_digest(old),
                          allFillAndClipOperandsIdentical=fresh == old))
    # Confirm both inputs are unchanged after parsing, including a reference-application-owned
    # source which may still be open. No save or automation operation is used.
    assert digest(owned_source) == reference['sourceSha256'], 'Owned source changed during comparison'
    assert digest(folder / 'native.pdf') == reference['pdfSha256'], 'Retained reference changed during comparison'
    return dict(sourceSha256=reference['sourceSha256'], sourceUnchanged=True,
                nativeSourcePdfSha256=digest(native_pdf), referencePdfSha256=reference['pdfSha256'],
                reader='pypdf rectangle graphics operands and active rectangular clip scopes; font programs not decoded',
                allNativeOperandsUnchanged=all(row['allFillAndClipOperandsIdentical'] for row in pages), pages=pages)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('native_pdf', type=Path)
    parser.add_argument('owned_source', type=Path)
    parser.add_argument('reference_folder', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    inputs = [args.native_pdf, args.owned_source, *args.reference_folder.iterdir()]
    if args.output.resolve() in {path.resolve() for path in inputs}:
        parser.error('Output must differ from every native/source/reference input.')
    result = compare(args.native_pdf, args.owned_source, args.reference_folder)
    args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(dict(pages=len(result['pages']), fills=sum(row['rectangleFills'] for row in result['pages']),
                         allNativeOperandsUnchanged=result['allNativeOperandsUnchanged'])))
