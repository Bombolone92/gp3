import json,hashlib,uuid
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from xml.sax.saxutils import escape
import sys
out=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]/'tests/fixtures/legacy-nbsp-font-policy'
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';r='http://schemas.openxmlformats.org/officeDocument/2006/relationships';p='http://schemas.openxmlformats.org/package/2006/relationships'
parts={};fonts=[];rels=[];rows=[];cases=[]
key='{00112233-4455-6677-8899-AABBCCDDEEFF}';octets=bytes.fromhex(key.strip('{}').replace('-',''))[::-1]
for i,c in enumerate(json.loads((out/'fonts.json').read_text())):
 b=bytearray((out/c['file']).read_bytes());key='{'+str(uuid.UUID(bytes=hashlib.sha256(b).digest()[:16])).upper()+'}';octets=bytes.fromhex(key.strip('{}').replace('-',''))[::-1]
 for j in range(32):b[j]^=octets[j%16]
 path=f'fonts/font{i}.odttf';parts['word/'+path]=b
 fonts.append(f'<w:font w:name="{c["family"]}"><w:embedRegular r:id="f{i}" w:fontKey="{key}" w:subsetted="false"/></w:font>')
 rels.append(f'<Relationship Id="f{i}" Type="{r}/font" Target="{path}"/>')
 for kern in [False,True]:
  for sep in [' ','\u00a0']:
   text='A'+sep+'WA';cases.append(dict(**c,kern=kern,text=text))
   rows.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="960" w:lineRule="exact"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="{c["family"]}" w:hAnsi="{c["family"]}"/><w:kern w:val="{2 if kern else 0}"/><w:sz w:val="72"/></w:rPr><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>')
parts.update({'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/></Types>',
'_rels/.rels':f'<Relationships xmlns="{p}"><Relationship Id="main" Type="{r}/officeDocument" Target="word/document.xml"/></Relationships>',
'word/document.xml':f'<w:document xmlns:w="{w}" xmlns:r="{r}"><w:body>{"".join(rows)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
'word/_rels/document.xml.rels':f'<Relationships xmlns="{p}"><Relationship Id="fonts" Type="{r}/fontTable" Target="fontTable.xml"/></Relationships>',
'word/fontTable.xml':f'<w:fonts xmlns:w="{w}" xmlns:r="{r}">{"".join(fonts)}</w:fonts>',
'word/_rels/fontTable.xml.rels':f'<Relationships xmlns="{p}">{"".join(rels)}</Relationships>'})
with ZipFile(out/'control.docx','w',ZIP_DEFLATED) as z:
 for name,b in parts.items():z.writestr(name,b.encode() if isinstance(b,str) else b)
(out/'cases.json').write_text(json.dumps(cases,indent=2))
print('Authored 12 original-font rows.')
