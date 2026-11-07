"""Original two-page control for comparing live native display and native export phases."""
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from lxml import etree as E
from rotated_spacing_phase_fixture import build as spacing_source, W

FOLDER = Path(__file__).resolve().parents[1] / 'tests/fixtures/cell-text-direction/live-screen'


def build():
    parts, _ = spacing_source()
    root = E.fromstring(parts['word/document.xml'])
    body = root.find(W + 'body')
    template, section = deepcopy(body.find(W + 'tbl')), deepcopy(body[-1])
    body.clear()
    row = template.find(W + 'tr')
    row.remove(row.find(W + 'tc'))
    grid = template.find(W + 'tblGrid')
    grid.remove(grid[0])
    template.find(W + 'tblPr/' + W + 'tblW').set(W + 'w', '2160')
    for twips in (0, 1):
        p = E.SubElement(body, W + 'p')
        pp = E.SubElement(p, W + 'pPr')
        if twips:
            E.SubElement(pp, W + 'pageBreakBefore')
        E.SubElement(E.SubElement(p, W + 'r'), W + 't').text = f'{twips} twips'
        table = deepcopy(template)
        table.find(W + 'tblPr/' + W + 'tblInd').set(W + 'w', str(twips))
        body.append(table)
    size = section.find(W + 'pgSz')
    size.set(W + 'w', '2880')
    size.set(W + 'h', '3600')
    margins = section.find(W + 'pgMar')
    for side in ('left', 'right', 'top', 'bottom'):
        margins.set(W + side, '180')
    body.append(section)
    parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    return parts


if __name__ == '__main__':
    FOLDER.mkdir(parents=True, exist_ok=True)
    with ZipFile(FOLDER / 'control.docx', 'w') as z:
        for name, data in build().items():
            info = ZipInfo(name, (2026, 9, 29, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            z.writestr(info, data)
