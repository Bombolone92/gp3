"""Original controls for shaded vertical merges and their following row."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
from lxml import etree as E

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/merged-shading-gap'
folder.mkdir(exist_ok=True)
with ZipFile(root / 'public/fixtures/shape-defaults.docx') as package:
    parts = {name: package.read(name) for name in package.namelist()}
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
cases = []
body = []
for merge, all_shaded, borders, tall, exact, neighbor_margin in [(False, True, '', False, True, 0), (True, False, '', False, True, 0), (True, True, '', False, True, 0), (True, False, 'nil', False, True, 0), (True, False, 'none', False, True, 0), (True, False, 'single', False, True, 0), (True, False, '', True, False, 0), (True, False, '', True, True, 0), (False, True, '', True, False, 0), (True, True, '', True, False, 0), (True, False, '', False, True, 29), (True, False, '', False, True, 120), (False, True, '', False, True, 120)]:
    name = f'{"merged" if merge else "separate"}-{all_shaded}-{borders or "absent"}-{tall}-{exact}-{neighbor_margin}'
    body.append(f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if cases else ""}</w:pPr><w:r><w:t>{name}</w:t></w:r></w:p>')
    border_xml = '<w:tblBorders>' + ''.join(f'<w:{side} w:val="{borders}" w:sz="8" w:color="FF0000"/>' for side in ['top','left','bottom','right','insideH','insideV']) + '</w:tblBorders>' if borders else ''
    rows = []
    heights = [1147, 1147, 1147, 1147, 4233, 2128, 163] if tall else [600] * 5
    merge_count = 5 if tall else 3
    for row, height in enumerate(heights):
        cells = []
        for col in range(2):
            vm = '<w:vMerge w:val="restart"/>' if merge and col == 1 and row == 0 else '<w:vMerge/>' if merge and col == 1 and row < merge_count else ''
            shade = '<w:shd w:val="clear" w:color="auto" w:fill="345D7E"/>' if col == 1 and (all_shaded or row == 0 or row >= merge_count) else ''
            margins = f'<w:tcMar><w:top w:w="{neighbor_margin}" w:type="dxa"/><w:bottom w:w="{neighbor_margin}" w:type="dxa"/></w:tcMar>' if col == 0 and row in [merge_count-1,merge_count] and neighbor_margin else ''
            text = f'Row {row+1}' if col == 0 else ''
            cells.append(f'<w:tc><w:tcPr><w:tcW w:w="3600" w:type="dxa"/>{vm}{shade}{margins}<w:vAlign w:val="center"/></w:tcPr><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:tc>')
        rows.append(f'<w:tr><w:trPr><w:trHeight w:val="{height}" w:hRule="{"exact" if exact else "atLeast"}"/></w:trPr>{"".join(cells)}</w:tr>')
    body.append(f'<w:tbl><w:tblPr><w:tblW w:w="7200" w:type="dxa"/>{border_xml}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="3600"/><w:gridCol w:w="3600"/></w:tblGrid>{"".join(rows)}</w:tbl>')
    cases.append(dict(name=name, merge=merge, allShaded=all_shaded, borders=borders, tall=tall, exact=exact, neighborMargin=neighbor_margin))
# Isolate which physical row's padding controls the merged shading edge.
profiles = [
    ('neighbor-all', [(r, 0, 120, 120) for r in range(5)]),
    ('neighbor-last-only', [(2, 0, 120, 120)]),
    ('neighbor-next-only', [(3, 0, 120, 120)]),
    ('neighbor-last-top', [(2, 0, 120, 0)]),
    ('neighbor-last-bottom', [(2, 0, 0, 120)]),
    ('owner-all', [(r, 1, 120, 120) for r in range(3)]),
    ('owner-start', [(0, 1, 120, 120)]),
    ('neighbor-start-and-last', [(0, 0, 120, 120), (2, 0, 120, 120)]),
]
for name, margins in profiles:
    table = E.fromstring(body[3].replace('<w:tbl>', f'<w:tbl xmlns:w="{W}">', 1).encode())
    for row, col, top, bottom in margins:
        pr = table.findall(f'{{{W}}}tr')[row].findall(f'{{{W}}}tc')[col].find(f'{{{W}}}tcPr')
        node = E.Element(f'{{{W}}}tcMar')
        for side, value in [('top', top), ('bottom', bottom)]:
            child = E.SubElement(node, f'{{{W}}}{side}')
            child.set(f'{{{W}}}w', str(value)); child.set(f'{{{W}}}type', 'dxa')
        pr.insert(len(pr) - 1, node)
    body.extend([f'<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>{name}</w:t></w:r></w:p>', E.tostring(table).decode()])
    cases.append(dict(name=name, margins=margins))
body.append('<w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'.encode()
parts['word/styles.xml'] = f'<w:styles xmlns:w="{W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:style></w:styles>'.encode()
parts['word/settings.xml'] = f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'.encode()
relations = E.fromstring(parts['word/_rels/document.xml.rels'])
E.SubElement(relations, '{http://schemas.openxmlformats.org/package/2006/relationships}Relationship', Id='rIdShadingSettings', Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings', Target='settings.xml')
parts['word/_rels/document.xml.rels'] = E.tostring(relations)
content = E.fromstring(parts['[Content_Types].xml'])
E.SubElement(content, '{http://schemas.openxmlformats.org/package/2006/content-types}Override', PartName='/word/settings.xml', ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml')
parts['[Content_Types].xml'] = E.tostring(content)
with ZipFile(folder / 'control.docx', 'w', ZIP_DEFLATED) as package:
    for name, data in parts.items():
        package.writestr(name, data)
(folder / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')
