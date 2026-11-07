"""Author independent explicit/theme/style Montserrat Light controls."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from lxml import etree as E
r=Path(__file__).resolve().parents[1];folder=r/'tests/fixtures/montserrat-theme';folder.mkdir(exist_ok=True);out=folder/'control.docx'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';A='http://schemas.openxmlformats.org/drawingml/2006/main';R='http://schemas.openxmlformats.org/package/2006/relationships';C='http://schemas.openxmlformats.org/package/2006/content-types'
with ZipFile(r/'public/fixtures/reviewed-font.docx')as z:parts={n:z.read(n)for n in z.namelist()}
with ZipFile(r/'public/fixtures/font-family-fallback-theme.docx')as z:theme=E.fromstring(z.read('word/theme/theme1.xml'))
for n in theme.findall('.//{'+A+'}minorFont/{'+A+'}latin'):n.set('typeface','Montserrat Light')
parts['word/theme/probe.xml']=E.tostring(theme)
rels=E.fromstring(parts['word/_rels/document.xml.rels']);E.SubElement(rels,'{'+R+'}Relationship',Id='themeProbe',Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',Target='theme/probe.xml');parts['word/_rels/document.xml.rels']=E.tostring(rels)
ct=E.fromstring(parts['[Content_Types].xml']);E.SubElement(ct,'{'+C+'}Override',PartName='/word/theme/probe.xml',ContentType='application/vnd.openxmlformats-officedocument.theme+xml');parts['[Content_Types].xml']=E.tostring(ct)
parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="character" w:styleId="Bold"><w:name w:val="Bold"/><w:rPr><w:b/></w:rPr></w:style></w:styles>'.encode()
body=[];cases=[]
for mode in ['explicit','theme','inherited']:
 for style in ['regular','direct-bold','character-bold']:
  f='<w:rFonts w:ascii="Montserrat Light" w:hAnsi="Montserrat Light"/>'if mode=='explicit'else'<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/>'if mode=='theme'else''
  b='<w:b/>'if style=='direct-bold'else'';c='<w:rStyle w:val="Bold"/>'if style=='character-bold'else''
  cases.append({'family':'Montserrat Light','size':12,'bold':style!='regular','italic':False,'text':f'{mode} {style}: Sincerely Hamburgefontsiv 012345'})
  body.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="160"/></w:pPr><w:r><w:rPr>{c}{f}{b}</w:rPr><w:t>{mode} {style}: Sincerely Hamburgefontsiv 012345</w:t></w:r></w:p>')
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:bottom="720" w:left="720" w:right="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>'.encode()
with ZipFile(out,'w',ZIP_DEFLATED)as z:
 for n,b in parts.items():
  info=ZipInfo(n,(2026,9,29,12,0,0));info.create_system=0;info.external_attr=0o600<<16;z.writestr(info,b)
print(out.resolve())

import json
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
