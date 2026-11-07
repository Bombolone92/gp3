"""Original OPC/XML controls for table defaults versus cell margin exceptions."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from canvas_first_section_fixture import parts, W

def mar(tag, value):
    if value is None: return ''
    special = value in ('nil', 'auto', 'pct')
    return f'<w:{tag}><w:right w:w="{0 if special else value}" w:type="{value if special else "dxa"}"/></w:{tag}>'

cases = [
    ('table24', None, None, None, None),
    ('global0', 0, None, None, None),
    ('global18', 360, None, None, None),
    ('conditional8', 0, 160, None, None),
    ('conditionalNil', 0, 'nil', None, None),
    ('directTable15', 0, None, 300, None),
    ('directCell12', 0, None, None, 240),
    ('directCellNil', 360, None, None, 'nil'),
    ('conditionalAuto', 0, 'auto', None, None),
    ('conditionalPct', 0, 'pct', None, None),
    ('directCellAuto', 360, None, None, 'auto'),
    ('directCellPct', 360, None, None, 'pct'),
    ('globalNil', 'nil', None, None, None),
    ('globalAuto', 'auto', None, None, None),
    ('directTable15CellNil', 360, None, 300, 'nil'),
    ('directTable15ConditionalNil', 360, 'nil', 300, None),
    ('row9CellNil', 360, None, None, 'nil'),
    ('row9ConditionalNil', 360, 'nil', None, None),
    ('row9Global18', 360, None, None, None),
    ('conditionalTable8Global18', 360, 160, None, None),
    ('conditionalTable8CellNil', 360, 160, None, 'nil'),
    ('derivedGlobalNil', 'nil', None, None, None),
]
styles = '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults>'
body = ''
for i, (name, glob, cond, directTable, directCell) in enumerate(cases):
    based = ''
    if name == 'derivedGlobalNil':
        styles += f'<w:style w:type="table" w:styleId="Base"><w:name w:val="Base"/><w:tcPr>{mar("tcMar",360)}</w:tcPr></w:style>'
        based = '<w:basedOn w:val="Base"/>'
    styles += f'<w:style w:type="table" w:styleId="M{i}"><w:name w:val="{name}"/>{based}<w:tblPr><w:tblCellMar><w:left w:w="240" w:type="dxa"/><w:right w:w="480" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tcPr>{mar("tcMar", glob)}</w:tcPr>'
    if cond is not None:
        prop, tag = ('tblPr', 'tblCellMar') if name.startswith('conditionalTable') else ('tcPr', 'tcMar')
        styles += f'<w:tblStylePr w:type="firstRow"><w:{prop}>{mar(tag, cond)}</w:{prop}></w:tblStylePr>'
    styles += '</w:style>'
    body += f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if i else ""}</w:pPr><w:r><w:t>{name}</w:t></w:r></w:p>'
    body += f'<w:tbl><w:tblPr><w:tblStyle w:val="M{i}"/><w:tblW w:w="7200" w:type="dxa"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/>{mar("tblCellMar", directTable)}<w:tblLook w:val="0620" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="7200"/></w:tblGrid>'
    for row in range(2):
        ex = f'<w:tblPrEx>{mar("tblCellMar",180)}</w:tblPrEx>' if name.startswith('row9') else ''
        body += f'<w:tr>{ex}<w:tc><w:tcPr><w:tcW w:w="7200" w:type="dxa"/>{mar("tcMar", directCell)}</w:tcPr>'
        for align in ['left', 'right']:
            body += f'<w:p><w:pPr><w:jc w:val="{align}"/></w:pPr><w:r><w:t>M{i}{row}{align[0]}</w:t></w:r></w:p>'
        body += '</w:tc></w:tr>'
    body += '</w:tbl><w:p/>'
parts['word/styles.xml'] = f'<w:styles xmlns:w="{W}">{styles}</w:styles>'
parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
out = Path(__file__).resolve().parents[1] / 'public/fixtures/cell-margin-reset.docx'
with ZipFile(out, 'w', ZIP_DEFLATED) as z:
    for name, text in parts.items(): z.writestr(name, '<?xml version="1.0" encoding="UTF-8"?>' + text)
print(out)
