"""Original XML controls for after-spacing across cell and row boundaries."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from itertools import product
import json
root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/cell-next-context'
folder.mkdir(exist_ok=True)
base=root/'tests/fixtures/cell-end-context/control.docx'
with ZipFile(base) as z:parts={n:z.read(n) for n in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Shared"><w:name w:val="Shared"/></w:style><w:style w:type="paragraph" w:styleId="Other"><w:name w:val="Other"/></w:style></w:styles>'
body=[];cases=[]
for i,(current,rowbreak,empty,nextstyle,context) in enumerate(product(['Shared','Normal'],[False,True],[False,True],['Shared','Other','Normal'],[False,True])):
 cases.append(dict(index=i,current=current,rowbreak=rowbreak,empty=empty,nextstyle=nextstyle,context=context))
 body.append(f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if i else ""}<w:spacing w:after="0"/></w:pPr><w:r><w:t>Case {i}</w:t></w:r></w:p>')
 cells=[]
 for col in range(2):
  style=current if col==0 else nextstyle
  paras=[]
  for n in range(2):
   text='' if empty and col==0 and n==1 else f'C{col}P{n}'
   after=160 if col==0 and n==1 else 0
   paras.append(f'<w:p><w:pPr><w:pStyle w:val="{style}"/><w:spacing w:before="0" w:after="{after}" w:line="280" w:lineRule="exact"/>{"<w:contextualSpacing/>" if context else ""}</w:pPr>{"<w:r><w:t>"+text+"</w:t></w:r>" if text else ""}</w:p>')
  cells.append('<w:tc><w:tcPr><w:tcW w:w="3600" w:type="dxa"/></w:tcPr>'+''.join(paras)+'</w:tc>')
 rows='</w:tr><w:tr>'.join(cells) if rowbreak else ''.join(cells)
 body.append('<w:tbl><w:tblPr><w:tblW w:w="7200" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="3600"/>'+('' if rowbreak else '<w:gridCol w:w="3600"/>')+'</w:tblGrid><w:tr>'+rows+'</w:tr></w:tbl><w:p><w:r><w:t>AFTER</w:t></w:r></w:p>')
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>'
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(folder/'cases.json').write_text(json.dumps(cases,indent=2))
