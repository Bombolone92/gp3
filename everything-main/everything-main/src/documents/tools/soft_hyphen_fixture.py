from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from xml.sax.saxutils import escape
ROOT=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
def p(text,narrow=False):
 runs='<w:r><w:t>'+escape(text).replace('\u00ad','</w:t><w:softHyphen/><w:t>')+'</w:t></w:r>'
 return '<w:p><w:pPr><w:spacing w:after="120" w:line="320" w:lineRule="exact"/>'+('<w:ind w:right="8460"/>' if narrow else '')+'</w:pPr>'+runs+'</w:p>'
body=p('Soft hyphen control')+p('Unbroken: extra\u00adordinary')+p('Narrow discretionary break')+p('extra\u00adordinary',True)+p('Narrow ordinary word')+p('extraordinary',True)+p('Multiple opportunities')+p('co\u00adoper\u00adation',True)+p('Kerning: AV\u00adAV')+p('\u00ad')+p('Trailing\u00ad')+p('Done')
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
'_rels/.rels':f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
'word/_rels/document.xml.rels':f'<Relationships xmlns="{REL}"><Relationship Id="styles" Type="{R}/styles" Target="styles.xml"/></Relationships>',
'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>',
'word/styles.xml':f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>'}
with ZipFile(ROOT/'public/fixtures/soft-hyphens.docx','w',ZIP_DEFLATED) as z:
 for n,s in parts.items():z.writestr(n,s)
