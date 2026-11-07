"""Manually authored horizontal-alignment holdouts; no document-engine output."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib
import json
import argparse
from copy import deepcopy

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'tests/fixtures/aligned-multipage-floating'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/package/2006/relationships'
CASES = ['left', 'center', 'right', 'inside', 'outside']

def paragraph(text, properties=''):
    return f'<w:p>{properties}<w:r><w:t>{text}</w:t></w:r></w:p>'

def section():
    return '<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'

def generate():
    global DEST
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-directory', type=Path, default=DEST)
    args = parser.parse_args()
    DEST = args.output_directory
    DEST.mkdir(parents=True, exist_ok=True)
    body = []
    for index, alignment in enumerate(CASES):
        borders = ''.join(f'<w:{side} w:val="single" w:sz="8" w:color="000000"/>' for side in ['top', 'left', 'bottom', 'right'])
        props = f'<w:tblPr><w:tblpPr w:horzAnchor="margin" w:vertAnchor="margin" w:tblpXSpec="{alignment}" w:tblpY="0" w:leftFromText="180" w:rightFromText="180"/><w:tblW w:w="4320" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>'
        rows = ''.join('<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="960" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="4320" w:type="dxa"/></w:tcPr>' + paragraph(f'{alignment} row {row:02}') + '</w:tc></w:tr>' for row in range(18))
        body.append(f'<w:tbl>{props}<w:tblGrid><w:gridCol w:w="4320"/></w:tblGrid>{rows}</w:tbl>')
        body.append(paragraph(f'{alignment} anchor after table'))
        if index < len(CASES) - 1:
            body.append(paragraph(f'{alignment} section end', f'<w:pPr>{section()}</w:pPr>'))
    body.append(section())
    parts = {
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
        '_rels/.rels': f'<Relationships xmlns="{R}"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/_rels/document.xml.rels': f'<Relationships xmlns="{R}"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="settings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
        'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>',
        'word/styles.xml': f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>',
        'word/settings.xml': f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
    }
    path = DEST / 'control.docx'
    with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
        for name, text in parts.items():
            entry = ZipInfo(name, (2026, 10, 10, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            archive.writestr(entry, text.encode())
    # A separate short-table holdout isolates importer/placement semantics from
    # the intentionally unsupported multi-page positioning combinations.
    short_parts = dict(parts)
    from lxml import etree as E
    document = E.fromstring(short_parts['word/document.xml'].encode())
    for table in document.findall(f'.//{{{W}}}tbl'):
        for row in table.findall(f'{{{W}}}tr')[3:]:
            table.remove(row)
    short_parts['word/document.xml'] = E.tostring(document).decode()
    short_path = DEST / 'single-page.docx'
    with ZipFile(short_path, 'w', ZIP_DEFLATED) as archive:
        for name, text in short_parts.items():
            entry = ZipInfo(name, (2026, 10, 10, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            archive.writestr(entry, text.encode())
    (DEST / 'cases.json').write_text(json.dumps({'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'alignments': CASES, 'rowsPerTable': 18, 'rowMinimumTwips': 960, 'scope': 'Independent horizontal alignment and continuation-page holdouts, modern compatibility mode; vertical alignment and native glyph ink are outside this control.'}, indent=2) + '\n', encoding='utf-8')
    print(path)
    (DEST / 'single-page-cases.json').write_text(json.dumps({'sourceSha256': hashlib.sha256(short_path.read_bytes()).hexdigest(), 'alignments': CASES, 'rowsPerTable': 3, 'rowMinimumTwips': 960, 'scope': 'Separate single-page table holdouts; independently authored section starts establish actual page parity.'}, indent=2) + '\n', encoding='utf-8')
    parity_cases = [('inside-even', 'inside'), ('inside-odd', 'inside'), ('outside-even', 'outside'), ('outside-odd', 'outside')]
    prototypes = {table.find(f'{{{W}}}tblPr/{{{W}}}tblpPr').get(f'{{{W}}}tblpXSpec'): table for table in document.findall(f'.//{{{W}}}tbl')}
    parity_document = E.fromstring(f'<w:document xmlns:w="{W}"><w:body/></w:document>'.encode())
    parity_body = parity_document.find(f'{{{W}}}body')
    for index, (label, alignment) in enumerate(parity_cases):
        table = deepcopy(prototypes[alignment])
        for row_index, text in enumerate(table.findall(f'.//{{{W}}}t')):
            text.text = f'{label} row {row_index:02}'
        parity_body.append(table)
        parity_body.append(E.fromstring(paragraph(f'{label} anchor after table').replace('<w:p>', f'<w:p xmlns:w="{W}">', 1).encode()))
        if index < len(parity_cases) - 1:
            parity_body.append(E.fromstring(paragraph(f'{label} section end', f'<w:pPr>{section()}</w:pPr>').replace('<w:p>', f'<w:p xmlns:w="{W}">', 1).encode()))
    parity_body.append(E.fromstring(section().replace('<w:sectPr>', f'<w:sectPr xmlns:w="{W}">', 1).encode()))
    parity_parts = {**parts, 'word/document.xml': E.tostring(parity_document).decode()}
    parity_path = DEST / 'single-page-parity.docx'
    with ZipFile(parity_path, 'w', ZIP_DEFLATED) as archive:
        for name, text in parity_parts.items():
            entry = ZipInfo(name, (2026, 10, 10, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            archive.writestr(entry, text.encode())
    (DEST / 'single-page-parity-cases.json').write_text(json.dumps({'sourceSha256': hashlib.sha256(parity_path.read_bytes()).hexdigest(), 'cases': [{'label': label, 'alignment': alignment, 'page': index} for index, (label, alignment) in enumerate(parity_cases)], 'rowsPerTable': 3, 'scope': 'Independent recto/verso holdouts for both page-relative horizontal alignments.'}, indent=2) + '\n', encoding='utf-8')

if __name__ == '__main__':
    generate()
