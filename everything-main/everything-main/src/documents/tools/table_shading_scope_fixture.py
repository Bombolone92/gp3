"""Original controls separating table shading from cell shading in the native reference."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
root=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(root/'public/fixtures/shape-defaults.docx') as z:
    parts={n:z.read(n) for n in z.namelist()}
shade=lambda color:f'<w:shd w:val="clear" w:fill="{color}"/>'
orange=shade('FFAA44');green=shade('88CC99');blue=shade('99BBEE')
styles=f'''<w:styles xmlns:w="{W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TablePaint"><w:name w:val="Table paint"/><w:tblPr>{orange}</w:tblPr></w:style>
<w:style w:type="table" w:styleId="CellPaint"><w:name w:val="Cell paint"/><w:tblPr>{orange}</w:tblPr><w:tcPr>{green}</w:tcPr></w:style>
<w:style w:type="table" w:styleId="RegionTable"><w:name w:val="Regional table paint"/><w:tblStylePr w:type="firstRow"><w:tblPr>{orange}</w:tblPr></w:tblStylePr></w:style>
<w:style w:type="table" w:styleId="RegionCell"><w:name w:val="Regional cell paint"/><w:tblStylePr w:type="firstRow"><w:tcPr>{green}</w:tcPr></w:tblStylePr></w:style></w:styles>'''
cases=[('Direct table',None,orange,False),('Table style','TablePaint','',False),('Cell style','CellPaint',orange,True),('Regional table','RegionTable','',False),('Regional cell','RegionCell',orange,True)]
body=[]
for i,(label,style,tablepaint,direct) in enumerate(cases):
    body.append(f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if i else ""}</w:pPr><w:r><w:t>{label}</w:t></w:r></w:p>')
    props=(f'<w:tblStyle w:val="{style}"/>' if style else '')+'<w:tblW w:w="8640" w:type="dxa"/>'+tablepaint+'<w:tblLayout w:type="fixed"/><w:tblLook w:val="0620"/>'
    cells=''.join(f'<w:tc><w:tcPr><w:tcW w:w="4320" w:type="dxa"/>{blue if direct and j else ""}</w:tcPr><w:p><w:r><w:t>{label} {j+1}</w:t></w:r></w:p></w:tc>' for j in range(2))
    body.append(f'<w:tbl><w:tblPr>{props}</w:tblPr><w:tblGrid><w:gridCol w:w="4320"/><w:gridCol w:w="4320"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="1440" w:hRule="exact"/></w:trPr>{cells}</w:tr></w:tbl>')
body.append('<w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'.encode()
parts['word/styles.xml']=styles.encode()
for name in ['word/document.xml','word/styles.xml']: E.fromstring(parts[name])
with ZipFile(root/'public/fixtures/table-shading-scope.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items():z.writestr(name,data)
