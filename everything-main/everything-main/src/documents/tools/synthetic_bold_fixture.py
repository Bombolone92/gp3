"""Independent original synthetic-bold controls; no font files embedded."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from xml.sax.saxutils import escape
import json
ROOT=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';REL='http://schemas.openxmlformats.org/package/2006/relationships';CT='application/vnd.openxmlformats-officedocument.wordprocessingml.'
fonts=['Franklin Gothic Demi','Arial Black','Arial','Times New Roman','Franklin Gothic Book','Arial Bold'];cases=[];body=''
for name in fonts:
 for bold,italic in [(False,False),(True,False),(False,True),(True,True)]:
  i=len(cases);text=f'B{i:02d} Hg0123 Bold sample';cases.append(dict(id=f'B{i:02d}',font=name,bold=bold,italic=italic,text=text,size=24))
  body+=f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if i and i%12==0 else ""}<w:spacing w:before="0" w:after="0" w:line="840" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="{name}" w:hAnsi="{name}"/><w:b w:val="{int(bold)}"/><w:i w:val="{int(italic)}"/><w:sz w:val="48"/></w:rPr><w:t>{escape(text)}</w:t></w:r></w:p>'
parts={'[Content_Types].xml':f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="{CT}document.main+xml"/></Types>','_rels/.rels':f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>','word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'}
out=ROOT/'public/fixtures/synthetic-bold.docx'
with ZipFile(out,'w',ZIP_DEFLATED) as z:
 for n,t in parts.items():z.writestr(n,'<?xml version="1.0" encoding="UTF-8"?>'+t)
folder=ROOT/'tests/fixtures/synthetic-bold';folder.mkdir(exist_ok=True);(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
