"""Author independent U+2028 font-fallback controls; recapture the native reference after running."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from xml.sax.saxutils import escape
import json
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/line-separator-fonts'
OUT.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';REL='http://schemas.openxmlformats.org/package/2006/relationships'
cases=[('none','', 'Arial',9,'default'),('space',' ', 'Arial',9,'default'),('arial','\u2028','Arial',9,'default'),('arial-east','\u2028','Arial',9,'eastAsia'),('courier','\u2028','Courier New',9,'default'),('times','\u2028','Times New Roman',9,'default'),('calibri','\u2028','Calibri',9,'default'),('large','\u2028','Arial',18,'default')]
def rp(f='Arial',s=9,h='default'):return f'<w:rFonts w:ascii="{f}" w:hAnsi="{f}" w:eastAsia="{f}" w:cs="{f}" w:hint="{h}"/><w:sz w:val="{s*2}"/><w:szCs w:val="{s*2}"/>'
def p(txt,extra='',first=False):return f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if first else ""}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:rPr>{rp()}</w:rPr></w:pPr><w:r><w:rPr>{rp()}</w:rPr><w:t>{escape(txt)}</w:t></w:r>{extra}</w:p>'
body=''
for i,(name,char,f,s,h) in enumerate(cases):
 extra=f'<w:r><w:rPr>{rp(f,s,h)}</w:rPr><w:t xml:space="preserve">{char}</w:t></w:r>' if char else ''
 body+=p('Start '+name,first=i>0)+p('Sample',extra)+p('Tail')
parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>','_rels/.rels':f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>','word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'}
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
 for n,t in parts.items():z.writestr(n,'<?xml version="1.0" encoding="UTF-8"?>'+t)
(OUT/'cases.json').write_text(json.dumps(cases))
