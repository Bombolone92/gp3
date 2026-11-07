"""Independent full-width floating-table paragraph-spacing controls."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
root=Path(__file__).resolve().parents[1]/'tests/fixtures/floating-table-spacing'
root.mkdir(exist_ok=True)
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
cases=[]; body=[]
specs=[dict(blank=blank,border=border,before=before,previousAfter=previousAfter,anchor='text',offset=203,width=9360)
 for previousAfter in [0,80,200] for blank in [True,False] for border in [0,24] for before in [0,40,120]]
specs += [dict(blank=False,border=24,before=before,previousAfter=0,anchor=anchor,offset=offset,width=9360)
 for anchor,offset in [('page',1680),('margin',240)] for before in [0,120]]
specs += [dict(blank=False,border=24,before=before,previousAfter=0,anchor='text',offset=203,width=4320) for before in [0,120]]
specs += [dict(blank=False,border=border,before=0,previousAfter=0,anchor='page',offset=offset,width=9360) for border in [0,24] for offset in [1680,1681,1710,1720]]
for spec in specs:
 blank,border,before,previousAfter,anchor,offset,width=(spec[k] for k in ['blank','border','before','previousAfter','anchor','offset','width'])
 i=len(cases)+1
 cases.append(dict(page=i,**spec))
 body.append(f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if i>1 else ""}<w:spacing w:after="{previousAfter}"/></w:pPr><w:r><w:t>Case {i}</w:t></w:r></w:p>')
 edges=''.join(f'<w:{s} w:val="single" w:sz="{border}" w:color="00663D"/>' for s in ['top','bottom']) if border else ''
 body.append(f'<w:tbl><w:tblPr><w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="{anchor}" w:horzAnchor="margin" w:tblpX="0" w:tblpY="{offset}"/><w:tblW w:w="{width}" w:type="dxa"/><w:tblBorders>{edges}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="{width}"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="1440" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Table {i}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>')
 content='' if blank else f'<w:r><w:t>Anchor {i}</w:t></w:r>'
 body.append(f'<w:p><w:pPr><w:spacing w:before="{before}" w:after="40"/></w:pPr>{content}</w:p>')
 body.append(f'<w:p><w:pPr><w:spacing w:before="600" w:after="0"/></w:pPr><w:r><w:t>After {i}</w:t></w:r></w:p>')
body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>')
parts={
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
 '_rels/.rels':f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="{r}/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/_rels/document.xml.rels':f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="{r}/styles" Target="styles.xml"/><Relationship Id="settings" Type="{r}/settings" Target="settings.xml"/></Relationships>',
 'word/styles.xml':f'<w:styles xmlns:w="{w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>',
 'word/settings.xml':f'<w:settings xmlns:w="{w}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
 'word/document.xml':f'<w:document xmlns:w="{w}"><w:body>{"".join(body)}</w:body></w:document>',
}
with ZipFile(root/'control.docx','w',ZIP_DEFLATED) as z:
 for name,value in parts.items():z.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+value)
(root/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
print(root/'control.docx')
