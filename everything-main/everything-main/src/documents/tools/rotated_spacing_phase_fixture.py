"""Original paired rotated-cell controls: font, spacing, and table translation."""
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'tests/fixtures/cell-text-direction/spacing-phase'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def build():
    with ZipFile(ROOT / 'tests/fixtures/cell-text-direction/origin-phase/control.docx') as z:
        parts = {n: z.read(n) for n in z.namelist()}
    root = E.fromstring(parts['word/document.xml'])
    body = root.find(W + 'body')
    section, template = deepcopy(body[-1]), deepcopy(body.find(W + 'tbl'))
    body.clear()
    cases = []
    for font in ['Arial', 'Times New Roman', 'Courier New']:
        for rule, line in [('auto', 240), ('exact', 240), ('exact', 237)]:
            for twips in [0, 1, 2, 3]:
                p = E.SubElement(body, W + 'p')
                pp = E.SubElement(p, W + 'pPr')
                if cases:
                    E.SubElement(pp, W + 'pageBreakBefore')
                E.SubElement(E.SubElement(p, W + 'r'), W + 't').text = f'{font} {rule} {line} offset {twips}'
                table = deepcopy(template)
                table.find(W + 'tblPr').find(W + 'tblInd').set(W + 'w', str(twips))
                for cell in table.findall('.//' + W + 'tc'):
                    paragraph = cell.find(W + 'p')
                    pp = paragraph.find(W + 'pPr')
                    if pp is None:
                        pp = E.Element(W + 'pPr')
                        paragraph.insert(0, pp)
                    spacing = pp.find(W + 'spacing')
                    if spacing is None:
                        spacing = E.SubElement(pp, W + 'spacing')
                    spacing.set(W + 'line', str(line))
                    spacing.set(W + 'lineRule', rule)
                    # Match the terminal mark too; leaving its Arial face in
                    # place would confound a font-metric comparison.
                    for run in [pp, *paragraph.findall(W + 'r')]:
                        rp = run.find(W + 'rPr')
                        if rp is None:
                            rp = E.Element(W + 'rPr')
                            run.insert(0, rp)
                        rf = rp.find(W + 'rFonts')
                        if rf is None:
                            rf = E.Element(W + 'rFonts')
                            rp.insert(0, rf)
                        rf.attrib.clear()
                        for key in ['ascii', 'hAnsi', 'eastAsia', 'cs']:
                            rf.set(W + key, font)
                body.append(table)
                cases.append(dict(font=font, rule=rule, line=line, twips=twips))
    body.append(section)
    parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    return parts, cases


if __name__ == '__main__':
    FOLDER.mkdir(exist_ok=True)
    parts, cases = build()
    with ZipFile(FOLDER / 'control.docx', 'w') as z:
        for name, data in parts.items():
            info = ZipInfo(name, (2026, 9, 29, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            z.writestr(info, data)
    (FOLDER / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')
    print(f'Created {len(cases)} original paired table controls')
