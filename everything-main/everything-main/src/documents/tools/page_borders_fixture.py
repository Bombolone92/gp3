"""Original XML controls for section page borders."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from itertools import product
import json
root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/page-borders'
folder.mkdir(exist_ok=True)
with ZipFile(root/'tests/fixtures/cell-end-context/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>'
cases=[];body=[]
for i,(origin,display,order) in enumerate(product(['page','text'],['allPages','firstPage','notFirstPage'],['front','back'])):
 cases.append(dict(index=i,origin=origin,display=display,order=order))
 sides=''.join(f'<w:{s} w:val="single" w:sz="48" w:space="24" w:color="000000"/>' for s in ['top','left','bottom','right'])
 section=f'<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:pgBorders w:zOrder="{order}" w:display="{display}" w:offsetFrom="{origin}">{sides}</w:pgBorders></w:sectPr>'
 body.append(f'<w:p><w:r><w:t>Case {i}: {origin}, {display}, {order}, first</w:t></w:r></w:p>')
 body.append(f'<w:p><w:pPr><w:pageBreakBefore/>{section if i<11 else ""}</w:pPr><w:r><w:t>Case {i}: second</w:t></w:r></w:p>')
 if i==11:body.append(section)
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(folder/'cases.json').write_text(json.dumps(cases,indent=2))

# Overlap controls distinguish front/back and the omitted zOrder default.
body=[]
for i,order in enumerate(['front','back',None]):
 attr=f' w:zOrder="{order}"' if order else ''
 sides=''.join(f'<w:{s} w:val="single" w:sz="48" w:space="24" w:color="000000"/>' for s in ['top','left','bottom','right'])
 section=f'<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="480" w:right="480" w:bottom="480" w:left="480" w:header="720" w:footer="720" w:gutter="0"/><w:pgBorders w:offsetFrom="page"{attr}>{sides}</w:pgBorders></w:sectPr>'
 body.append(f'<w:p><w:pPr><w:shd w:val="clear" w:fill="FF0000"/><w:spacing w:line="1200" w:lineRule="exact"/>{section if i<2 else ""}</w:pPr><w:r><w:t>Overlap {order}</w:t></w:r></w:p>')
 if i==2:body.append(section)
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'
with ZipFile(folder/'overlap.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)

# Line-width boundary controls, including omitted size and normalization limits.
body=[]
for i,size in enumerate([None,0,1,2,4,8,96,200]):
 sz=f' w:sz="{size}"' if size is not None else ''
 sides=''.join(f'<w:{s} w:val="single"{sz} w:space="24" w:color="auto"/>' for s in ['top','left','bottom','right'])
 section=f'<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:pgBorders w:offsetFrom="page">{sides}</w:pgBorders></w:sectPr>'
 body.append(f'<w:p><w:pPr>{section if i<7 else ""}</w:pPr><w:r><w:t>Case width {size}</w:t></w:r></w:p>')
 if i==7:body.append(section)
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'
with ZipFile(folder/'widths.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
