"""Author the continuation/merged-row probes directly as OPC/XML, without the editor.

This uses only Python's standard library. Native reference measurements are separate
artifacts; this generator never generates expected layout values.
"""
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import argparse
import xml.etree.ElementTree as ET

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
Q = '{' + W + '}'
ET.register_namespace('w', W)

def paragraph(text):
    return '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Noto Sans" w:hAnsi="Noto Sans"/><w:sz w:val="20"/></w:rPr><w:t>' + text + '</w:t></w:r></w:p>'

def base_parts():
    borders = ''.join(f'<w:{side} w:val="single" w:sz="4" w:color="2050C0"/>' for side in ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'])
    margins = ''.join(f'<w:{side} w:w="144" w:type="dxa"/>' for side in ['top', 'left', 'bottom', 'right'])
    rows = ''.join('<w:tr>' + ''.join('<w:tc><w:tcPr><w:tcW w:w="2160" w:type="dxa"/></w:tcPr>' + paragraph(f'Inner {column}{index}') + '</w:tc>' for column in ['A', 'B']) + '</w:tr>' for index in range(1, 31))
    table = f'<w:tbl><w:tblPr><w:tblW w:w="4320" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar>{margins}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2160"/><w:gridCol w:w="2160"/></w:tblGrid>{rows}</w:tbl>'
    parts = {
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        '_rels/.rels': f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>' + paragraph('Nested table probe') + table + paragraph('After outer table') + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
    }
    return {name: ('<?xml version="1.0" encoding="UTF-8"?>' + xml).encode() for name, xml in parts.items()}

def table(document):
    return document.find('.//' + Q + 'tbl')

def set_borders(document, top, inside):
    for border in table(document).find(Q + 'tblPr').find(Q + 'tblBorders'):
        size = top if border.tag == Q + 'top' else inside
        border.set(Q + 'val', 'single' if size else 'nil')
        border.set(Q + 'sz', str(size))

def row_properties(row):
    properties = row.find(Q + 'trPr')
    if properties is None:
        properties = ET.Element(Q + 'trPr')
        row.insert(0, properties)
    return properties

def merge_column(document):
    rows = table(document).findall(Q + 'tr')
    owner = rows[0].find(Q + 'tc')
    sample = deepcopy(owner.find(Q + 'p'))
    for index, row in enumerate(rows):
        cell = row.find(Q + 'tc')
        ET.SubElement(cell.find(Q + 'tcPr'), Q + 'vMerge', {Q + 'val': 'restart' if index == 0 else 'continue'})
        for item in cell.findall(Q + 'p'): cell.remove(item)
        if index: ET.SubElement(cell, Q + 'p')
    for index in range(42):
        item = deepcopy(sample)
        item.find('.//' + Q + 't').text = f'Merge {index + 1:02}'
        owner.append(item)

def fixtures():
    base = ET.fromstring(base_parts()['word/document.xml'])
    documents = {}
    for size in [0, 4, 16]:
        document = deepcopy(base)
        set_borders(document, size, size)
        documents[f'nested-page-border-plain-{size}-{size}'] = document
    for top, inside in [(0, 16), (16, 0), (4, 16), (16, 4)]:
        document = deepcopy(base)
        set_borders(document, top, inside)
        documents[f'continuation-mixed-border-{top}-{inside}'] = document
    for top, inside in [(0, 16), (16, 0)]:
        original = documents[f'continuation-mixed-border-{top}-{inside}']
        for rule in ['exact', 'atLeast']:
            document = deepcopy(original)
            for row in table(document).findall(Q + 'tr'):
                ET.SubElement(row_properties(row), Q + 'trHeight', {Q + 'val': '600', Q + 'hRule': rule})
            documents[f'continuation-declared-row-{rule}-{top}-{inside}'] = document
        for kind in ['header', 'merge']:
            document = deepcopy(original)
            if kind == 'header': ET.SubElement(row_properties(table(document).find(Q + 'tr')), Q + 'tblHeader')
            else: merge_column(document)
            documents[f'continuation-structure-{kind}-{top}-{inside}'] = document
    for kind in ['owner', 'continuation', 'all']:
        document = deepcopy(documents['continuation-structure-merge-0-16'])
        for index, row in enumerate(table(document).findall(Q + 'tr')):
            if kind == 'owner' and index or kind == 'continuation' and not index: continue
            borders = ET.SubElement(row.find(Q + 'tc').find(Q + 'tcPr'), Q + 'tcBorders')
            ET.SubElement(borders, Q + 'top', {Q + 'val': 'single', Q + 'sz': '32', Q + 'color': '0055CC'})
        documents[f'continuation-direct-merged-{kind}'] = document
        document = deepcopy(document)
        owner = table(document).find(Q + 'tr').find(Q + 'tc')
        for index in range(42, 70):
            item = deepcopy(owner.find(Q + 'p'))
            item.find('.//' + Q + 't').text = f'Merge {index + 1:02}'
            owner.append(item)
        documents[f'continuation-long-merged-{kind}'] = document
    for size in [0, 16]:
        document = deepcopy(documents['continuation-long-merged-owner'])
        for properties in document.findall('.//' + Q + 'tcPr'):
            for borders in properties.findall(Q + 'tcBorders'): properties.remove(borders)
        set_borders(document, size, size)
        documents[f'continuation-long-control-{size}'] = document
    for count in [20, 70]:
        document = deepcopy(documents['continuation-long-control-0'])
        tbl = table(document)
        for row in tbl.findall(Q + 'tr')[3:]: tbl.remove(row)
        cell = tbl.find(Q + 'tr').find(Q + 'tc')
        for item in cell.findall(Q + 'p')[count:]: cell.remove(item)
        documents[f'continuation-allocation-{count}'] = document
    return documents

def generate(output):
    output.mkdir(parents=True, exist_ok=True)
    for name, document in fixtures().items():
        parts = base_parts()
        parts['word/document.xml'] = ET.tostring(document, encoding='utf-8', xml_declaration=True)
        with ZipFile(output / (name + '.docx'), 'w', ZIP_DEFLATED) as archive:
            for part, content in parts.items(): archive.writestr(part, content)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    generate(parser.parse_args().output)
