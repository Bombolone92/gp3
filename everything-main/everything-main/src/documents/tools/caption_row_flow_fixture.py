"""Original controls for caption rows, suppressed edges and merged spacers."""
from pathlib import Path
import argparse
import json
import tempfile
from xml.etree import ElementTree as E
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from table_label_context_fixture import generate as base_fixture, node, add, paragraph, table, W


def generate(root):
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as directory:
        base_fixture(Path(directory))
        with ZipFile(Path(directory) / 'control.docx') as z:
            parts = {name: z.read(name) for name in z.namelist()}
    styles = E.fromstring(parts['word/styles.xml'])
    caption = add(styles, 'style', type='paragraph', styleId='Caption')
    add(caption, 'name', val='Caption'); add(caption, 'basedOn', val='Normal')
    rp = add(caption, 'rPr'); add(rp, 'rFonts', ascii='Arial Black', hAnsi='Arial Black'); add(rp, 'sz', val=24)
    prefix = add(styles, 'style', type='paragraph', styleId='Prefix')
    add(prefix, 'name', val='Prefix'); add(prefix, 'basedOn', val='Normal')
    add(add(prefix, 'pPr'), 'spacing', before=40); add(add(prefix, 'rPr'), 'sz', val=20)
    cases = []; document = node('document'); body = add(document, 'body')
    definitions = [(True, True, True), (False, True, True), (True, False, True),
                   (False, False, True), (True, True, False), (False, True, False)]
    for index, (merge, spacer_nil, styled) in enumerate(definitions, 1):
        cases.append(dict(page=index, mergedSpacer=merge, spacerBottomNil=spacer_nil, styled=styled))
        title = paragraph('Case ' + str(index))
        if index > 1:
            title.insert(0, node('pPr')); add(title[0], 'pageBreakBefore')
        body.append(title)
        outer = node('tbl'); pr = add(outer, 'tblPr')
        if styled: add(pr, 'tblStyle', val='Grid')
        add(pr, 'tblW', w=6583, type='dxa'); add(pr, 'tblLayout', type='fixed')
        mar = add(pr, 'tblCellMar')
        for side, value in [('top', 113), ('left', 115), ('bottom', 113), ('right', 115)]: add(mar, side, w=value, type='dxa')
        grid = add(outer, 'tblGrid'); add(grid, 'gridCol', w=6300); add(grid, 'gridCol', w=283)
        for row_index in range(2):
            row = add(outer, 'tr')
            for col, width in enumerate((6300, 283)):
                cell = add(row, 'tc'); cp = add(cell, 'tcPr'); add(cp, 'tcW', w=width, type='dxa')
                if col == 1 and merge: add(cp, 'vMerge', **({'val': 'restart'} if row_index == 0 else {}))
                borders = add(cp, 'tcBorders')
                if col == 0:
                    add(borders, 'top', val='single' if row_index == 0 else 'nil', **({'sz': 24} if row_index == 0 else {}))
                    add(borders, 'left', val='single', sz=24)
                    add(borders, 'bottom', val='nil' if row_index == 0 else 'single', **({'sz': 24} if row_index else {}))
                    add(borders, 'right', val='single', sz=24)
                elif spacer_nil:
                    add(borders, 'bottom', val='nil')
                margins = add(cp, 'tcMar')
                for side, value in [('top', 216 if row_index == 0 and col == 0 else 0), ('bottom', 216 if row_index == 0 and col == 0 else 432 if row_index == 1 else 113)]:
                    add(margins, side, w=value, type='dxa')
                if col == 1:
                    cell.append(paragraph()); continue
                if row_index == 0:
                    p = paragraph(); add(add(p, 'pPr'), 'pStyle', val='Caption')
                    for line in range(4):
                        r = add(p, 'r')
                        if line: add(r, 'br')
                        add(r, 't').text = 'Caption'
                    cell.append(p)
                else:
                    p = paragraph(); add(add(p, 'pPr'), 'pStyle', val='Prefix'); cell.append(p)
                    cell.append(table(dict(styled=True, height='atLeast', nested=False, explicitSpacing=False, complexSize=False)))
                    cell.append(paragraph())
        body.append(outer); body.append(paragraph())
    sect = add(body, 'sectPr'); add(sect, 'pgSz', w=12240, h=15840)
    add(sect, 'pgMar', top=720, right=720, bottom=720, left=720, header=0, footer=0, gutter=0)
    parts['word/document.xml'] = E.tostring(document, encoding='utf-8', xml_declaration=True)
    parts['word/styles.xml'] = E.tostring(styles, encoding='utf-8', xml_declaration=True)
    with ZipFile(root / 'control.docx', 'w', ZIP_DEFLATED) as z:
        for name, data in parts.items():
            info = ZipInfo(name, (2026, 10, 3, 0, 0, 0)); info.compress_type = ZIP_DEFLATED
            z.writestr(info, data)
    (root / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')
    print(root / 'control.docx')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'tests/fixtures/caption-spacer-flow')
    generate(parser.parse_args().output)
