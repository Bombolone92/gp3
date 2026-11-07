"""Original table-width controls; no template or third-party artwork."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from html import escape
ROOT=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
cases=[('absolute overflow','dxa',10080,'autofit','left',0,10080,False),
 ('absolute fit','dxa',9360,'autofit','left',0,9360,False),
 ('fixed overflow','dxa',10080,'fixed','left',0,10080,False),
 ('percent overflow','pct',5500,'autofit','left',0,10080,False),
 ('automatic overflow grid','auto',0,'autofit','left',0,10080,False),
 ('center overflow','dxa',10080,'autofit','center',0,10080,False),
 ('right overflow','dxa',10080,'autofit','right',0,10080,False),
 ('indented overflow','dxa',10080,'autofit','left',360,10080,False),
 ('nested overflow','dxa',10080,'autofit','left',0,10080,True),
 ('larger table preference','dxa',10080,'autofit','left',0,9360,False),
 ('smaller table preference','dxa',9360,'autofit','left',0,10080,False),
 ('percent fit','pct',5000,'autofit','left',0,10080,False)]
def paragraph(text,br=False):
    return '<w:p><w:pPr>'+('<w:pageBreakBefore/>' if br else '')+'<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Noto Sans" w:hAnsi="Noto Sans"/><w:sz w:val="24"/></w:rPr><w:t>'+escape(text)+'</w:t></w:r></w:p>'
body=''
for i,(name,kind,width,layout,align,indent,grid,nested) in enumerate(cases):
    body+=paragraph('Table overflow controls: '+name,i>0)
    props=f'<w:tblPr><w:tblW w:type="{kind}" w:w="{width}"/><w:jc w:val="{align}"/><w:tblInd w:type="dxa" w:w="{indent}"/><w:tblLayout w:type="{layout}"/><w:tblCellMar>'+''.join(f'<w:{s} w:w="0" w:type="dxa"/>' for s in ['top','left','bottom','right'])+'</w:tblCellMar></w:tblPr>'
    widths=[grid*2//3,grid-grid*2//3]
    table='<w:tbl>'+props+'<w:tblGrid>'+''.join(f'<w:gridCol w:w="{v}"/>' for v in widths)+'</w:tblGrid><w:tr><w:trPr><w:trHeight w:val="600" w:hRule="exact"/></w:trPr>'
    for j,v in enumerate(widths):table+=f'<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="{v}"/><w:shd w:val="clear" w:fill="'+['336699','CC6633'][j]+'"/></w:tcPr>'+paragraph('A' if j==0 else 'B')+'</w:tc>'
    table+='</w:tr></w:tbl>'
    if nested:table='<w:tbl><w:tblPr><w:tblW w:w="7200" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar>'+''.join(f'<w:{s} w:w="0" w:type="dxa"/>' for s in ['top','left','bottom','right'])+'</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="7200"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="7200" w:type="dxa"/></w:tcPr>'+table+paragraph('')+'</w:tc></w:tr></w:tbl>'
    body+=table
body+=paragraph('')+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:left="1440" w:right="1440" w:bottom="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
with ZipFile(ROOT/'public/fixtures/merged-autofit.docx') as z:parts={n:z.read(n) for n in z.namelist()}
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()
with ZipFile(ROOT/'public/fixtures/table-overflow-width.docx','w',ZIP_DEFLATED) as z:
    for n,data in parts.items():z.writestr(n,data)
parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'.encode()
parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace(b'</Types>',b'<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>')
parts['word/_rels/document.xml.rels']=b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="settings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>'
with ZipFile(ROOT/'public/fixtures/table-overflow-width-modern.docx','w',ZIP_DEFLATED) as z:
    for n,data in parts.items():z.writestr(n,data)
