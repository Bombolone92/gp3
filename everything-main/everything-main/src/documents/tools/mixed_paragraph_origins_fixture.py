"""Independent controls for mixed-size manual breaks and paragraph transitions."""
import argparse
import json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from lxml import etree as E
from paragraph_gap_rounding_fixture import generate as generate_shell, N, W

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'tests/fixtures/mixed-paragraph-origins'


def generate(destination=DEST):
    generate_shell(destination)
    with ZipFile(destination / 'control.docx') as package:
        parts = {name: package.read(name) for name in package.namelist()}
    document = E.Element(N + 'document', nsmap={'w': W})
    body = E.SubElement(document, N + 'body')
    cases = []
    count = 0
    for family in ['Arial', 'Trebuchet MS', 'Times New Roman']:
        for mark_size in [11, 12, 28]:
            for after in [0, 30]:
                for prefix in [0, 5]:
                    first = True
                    labels = []

                    def paragraph(size, gap):
                        nonlocal count, first
                        p = E.SubElement(body, N + 'p')
                        pr = E.SubElement(p, N + 'pPr')
                        if cases and first:
                            E.SubElement(pr, N + 'pageBreakBefore')
                        first = False
                        E.SubElement(pr, N + 'spacing', {N + 'before': '0', N + 'after': str(gap * 20), N + 'line': '259', N + 'lineRule': 'auto'})
                        rp = E.SubElement(pr, N + 'rPr')
                        E.SubElement(rp, N + 'rFonts', {N + 'ascii': family, N + 'hAnsi': family})
                        E.SubElement(rp, N + 'sz', {N + 'val': str(size * 2)})
                        count += 1
                        return p

                    def run(p, size, text=None, br=False):
                        r = E.SubElement(p, N + 'r')
                        rp = E.SubElement(r, N + 'rPr')
                        E.SubElement(rp, N + 'rFonts', {N + 'ascii': family, N + 'hAnsi': family})
                        E.SubElement(rp, N + 'sz', {N + 'val': str(size * 2)})
                        if text:
                            E.SubElement(r, N + 't').text = text
                            labels.append(text)
                        if br:
                            E.SubElement(r, N + 'br')

                    for i in range(prefix):
                        p = paragraph(11, 8)
                        if i == 0:
                            run(p, 11, 'START')
                    p = paragraph(mark_size, after)
                    run(p, 28, 'TITLE', br=True)
                    run(p, 12, 'BY')
                    run(p, 11, 'AUTHOR')
                    p = paragraph(11, 8)
                    run(p, 11, 'BODY ONE', br=True)
                    run(p, 11, 'BODY TWO')
                    run(paragraph(11, 0), 11, 'AFTER')
                    cases.append(dict(page=len(cases), family=family, markSize=mark_size, after=after, prefix=prefix, labels=labels))
    old = E.fromstring(parts['word/document.xml'])
    body.append(old.find(N + 'body/' + N + 'sectPr'))
    parts['word/document.xml'] = E.tostring(document, xml_declaration=True, encoding='UTF-8', standalone=True)
    with ZipFile(destination / 'control.docx', 'w', ZIP_DEFLATED) as package:
        for name, data in parts.items():
            entry = ZipInfo(name, (2020, 1, 1, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            package.writestr(entry, data)
    (destination / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n', encoding='utf-8')
    print(f'{len(cases)} pages, {count} paragraphs')
    return destination / 'control.docx'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', type=Path, default=DEST)
    print(generate(parser.parse_args().destination))
