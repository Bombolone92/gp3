"""Author original kept-heading/fully-merged-table OPC/XML probes."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import argparse
import xml.etree.ElementTree as ET
from continuation_border_fixtures import base_parts, paragraph, Q, W
ET.register_namespace('w', W)

def fixtures():
    output = {}
    for keep in [False, True]:
        parts = base_parts()
        document = ET.fromstring(parts['word/document.xml'])
        body = document.find(Q + 'body')
        for child in list(body): body.remove(child)
        def p(text, heading=False):
            node = ET.fromstring(f'<root xmlns:w="{W}">' + paragraph(text) + '</root>')[0]
            node.find(Q + 'pPr').find(Q + 'spacing').set(Q + 'line', '300')
            node.find('.//' + Q + 'sz').set(Q + 'val', '24')
            if heading: node.find(Q + 'pPr').insert(0, ET.Element(Q + 'keepNext'))
            return node
        for text in ['Lead A', 'Lead B', 'Heading']: body.append(p(text, text == 'Heading'))
        table = ET.SubElement(body, Q + 'tbl')
        properties = ET.SubElement(table, Q + 'tblPr')
        ET.SubElement(properties, Q + 'tblW', {Q + 'w': '9360', Q + 'type': 'dxa'})
        borders = ET.SubElement(properties, Q + 'tblBorders')
        for side in ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']:
            ET.SubElement(borders, Q + side, {Q + 'val': 'single', Q + 'sz': '4', Q + 'color': '2050C0'})
        ET.SubElement(properties, Q + 'tblLayout', {Q + 'type': 'fixed'})
        margins = ET.SubElement(properties, Q + 'tblCellMar')
        for side in ['top', 'left', 'bottom', 'right']:
            ET.SubElement(margins, Q + side, {Q + 'w': '0' if side in ['top', 'bottom'] else '115', Q + 'type': 'dxa'})
        grid = ET.SubElement(table, Q + 'tblGrid')
        ET.SubElement(grid, Q + 'gridCol', {Q + 'w': '9360'})
        for index in range(3):
            row = ET.SubElement(table, Q + 'tr')
            rowpr = ET.SubElement(row, Q + 'trPr')
            ET.SubElement(rowpr, Q + 'cantSplit', {Q + 'val': '1' if keep else '0'})
            cell = ET.SubElement(row, Q + 'tc')
            cellpr = ET.SubElement(cell, Q + 'tcPr')
            ET.SubElement(cellpr, Q + 'tcW', {Q + 'w': '9360', Q + 'type': 'dxa'})
            ET.SubElement(cellpr, Q + 'vMerge', {Q + 'val': 'restart' if index == 0 else 'continue'})
            cell.append(p('Word ' * 100) if index == 0 else ET.Element(Q + 'p'))
        section = ET.SubElement(body, Q + 'sectPr')
        ET.SubElement(section, Q + 'pgSz', {Q + 'w': '12240', Q + 'h': '1680'})
        ET.SubElement(section, Q + 'pgMar', {Q + 'top': '300', Q + 'bottom': '300', Q + 'left': '1440', Q + 'right': '1440', Q + 'header': '0', Q + 'footer': '0', Q + 'gutter': '0'})
        parts['word/document.xml'] = ET.tostring(document, encoding='utf-8', xml_declaration=True)
        output[f'continuation-keep-heading-{int(keep)}'] = parts
    return output

def generate(output):
    output.mkdir(parents=True, exist_ok=True)
    for name, parts in fixtures().items():
        with ZipFile(output / (name + '.docx'), 'w', ZIP_DEFLATED) as archive:
            for part, content in parts.items(): archive.writestr(part, content)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    generate(parser.parse_args().output)
