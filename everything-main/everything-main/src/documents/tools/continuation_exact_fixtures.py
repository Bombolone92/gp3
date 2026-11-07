"""Author original exact-height border/padding probes using only OPC/XML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import argparse
import xml.etree.ElementTree as ET
from continuation_border_fixtures import base_parts, Q, row_properties, set_borders

def fixtures():
    cases = [(height, top, bottom, margin) for margin in [144, 0]
             for height, top, bottom in [(20, 96, 0), (120, 96, 0), (240, 96, 0), (20, 0, 96), (20, 96, 96), (20, 0, 0)]]
    cases += [(1, 4, 4, 0), (1, 4, 0, 0)]
    result = {}
    for height, top, bottom, margin in cases:
        document = ET.fromstring(base_parts()['word/document.xml'])
        table = document.find('.//' + Q + 'tbl')
        for side in ['top', 'bottom']:
            table.find(Q + 'tblPr').find(Q + 'tblCellMar').find(Q + side).set(Q + 'w', str(margin))
        for row in table.findall(Q + 'tr')[2:]: table.remove(row)
        set_borders(document, top, bottom)
        ET.SubElement(row_properties(table.find(Q + 'tr')), Q + 'trHeight', {Q + 'val': str(height), Q + 'hRule': 'exact'})
        name = f'continuation-small-exact-{height}-{top}-{bottom}' + ('-zero' if margin == 0 else '')
        result[name] = document
    for height in [20, 240]:
        for oversized in [False, True]:
            document = ET.fromstring(base_parts()['word/document.xml'])
            body = document.find(Q + 'body'); table = body.find(Q + 'tbl')
            body.find(Q + 'p').find(Q + 'pPr').find(Q + 'spacing').set(Q + 'line', '240' if oversized else '1440')
            for row in table.findall(Q + 'tr')[2:]: table.remove(row)
            set_borders(document, 0, 0)
            for side in ['top', 'bottom']:
                table.find(Q + 'tblPr').find(Q + 'tblCellMar').find(Q + side).set(Q + 'w', '0')
            first, second = table.findall(Q + 'tr')
            for cell in first.findall(Q + 'tc'):
                borders = ET.SubElement(cell.find(Q + 'tcPr'), Q + 'tcBorders')
                ET.SubElement(borders, Q + 'bottom', {Q + 'val': 'single', Q + 'sz': '96', Q + 'color': '2050C0'})
            if oversized: ET.SubElement(row_properties(first), Q + 'trHeight', {Q + 'val': '1800', Q + 'hRule': 'exact'})
            ET.SubElement(row_properties(second), Q + 'trHeight', {Q + 'val': str(height), Q + 'hRule': 'exact'})
            section = body.find(Q + 'sectPr'); section.find(Q + 'pgSz').set(Q + 'h', '2400')
            for side in ['top', 'bottom']: section.find(Q + 'pgMar').set(Q + side, '300')
            name = f'continuation-small-exact-page-{height}' + ('-oversized' if oversized else '')
            result[name] = document
    return result

def generate(folder):
    folder.mkdir(parents=True, exist_ok=True)
    for name, document in fixtures().items():
        parts = base_parts()
        parts['word/document.xml'] = ET.tostring(document, encoding='utf-8', xml_declaration=True)
        with ZipFile(folder / (name + '.docx'), 'w', ZIP_DEFLATED) as archive:
            for part, content in parts.items(): archive.writestr(part, content)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    generate(parser.parse_args().output)
