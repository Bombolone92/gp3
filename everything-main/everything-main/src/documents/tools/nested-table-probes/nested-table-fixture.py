"""Independent minimal nested-table probe, authored directly as OPC/XML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import sys
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
def p(text):
    return '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Noto Sans" w:hAnsi="Noto Sans"/><w:sz w:val="20"/></w:rPr><w:t>'+text+'</w:t></w:r></w:p>'
def table(rows,widths,color):
    total=sum(widths)
    borders=''.join(f'<w:{side} w:val="single" w:sz="4" w:color="{color}"/>' for side in ['top','left','bottom','right','insideH','insideV'])
    margins=''.join(f'<w:{side} w:w="144" w:type="dxa"/>' for side in ['top','left','bottom','right'])
    grid=''.join(f'<w:gridCol w:w="{width}"/>' for width in widths)
    content=''.join('<w:tr>'+''.join(f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/></w:tcPr>{value}</w:tc>' for width,value in zip(widths,row))+'</w:tr>' for row in rows)
    return f'<w:tbl><w:tblPr><w:tblW w:w="{total}" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar>{margins}</w:tblCellMar></w:tblPr><w:tblGrid>{grid}</w:tblGrid>{content}</w:tbl>'
inner=table([[p('Inner A1'),p('Inner B1')],[p('Inner A2'),p('Inner B2')]],[2160,2160],'2050C0')
variant=sys.argv[1] if len(sys.argv)>1 else 'probe'
if variant=='deep':inner=inner.replace(p('Inner A1'),table([[p('Deep cell')]],[1440],'008040')+p('Inner A1'))
if variant=='paging':inner=table([[p(f'Inner A{i}'),p(f'Inner B{i}')] for i in range(1,31)],[2160,2160],'2050C0')
outer=table([[p('Outer before')+inner+p('Outer after'),p('Outer side')],[p('Outer lower left'),p('Outer lower right')]],[5760,2880],'000000')
if variant=='first':outer=outer.replace(p('Outer before'),'')
if variant=='center':
    outer=outer.replace('<w:tr>','<w:tr><w:trPr><w:trHeight w:val="7200" w:hRule="atLeast"/></w:trPr>',1)
    outer=outer.replace('</w:tcPr>','<w:vAlign w:val="center"/></w:tcPr>',1)
if variant=='autofit':outer=outer.replace('<w:tblLayout w:type="fixed"/>','<w:tblLayout w:type="autofit"/>')
parts={
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>'+p('Nested table probe')+outer+p('After outer table')+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
}
output=Path(sys.argv[2]) if len(sys.argv)>2 else Path(__file__).resolve().parents[2]/'tests/fixtures/nested-tables'
output.mkdir(parents=True,exist_ok=True)
path=output/f'nested-table-{variant}.docx'
with ZipFile(path,'w',ZIP_DEFLATED) as package:
    for name,xml in parts.items():package.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+xml)
print(path)
