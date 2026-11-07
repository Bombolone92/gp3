"""Independently authored table-width rounding controls; no corpus XML."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from html import escape
ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'tests/fixtures/table-twip-widths';DEST.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(ROOT/'tests/fixtures/table-row-keep-next/none.docx') as z:parts={n:z.read(n) for n in z.namelist()}
def p(text,br=False):return '<w:p><w:pPr>'+('<w:pageBreakBefore/>' if br else '')+'<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:t>'+escape(text)+'</w:t></w:r></w:p>'
cases=[dict(mode=mode,total=6000,grid=[1000,2000,3000],text=['A','B','C'],prefs=prefs) for mode in ['fixed','autofit'] for prefs in [[833,1667,2500],[833,1666,2500],[834,1666,2500],[832,1666,2500],[830,1660,2490],[850,1650,2500]]]
body=''
for i,c in enumerate(cases):
 body+=p(f'Case {i+1}: {c["mode"]} {c["total"]}',i>0)+f'<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="{c["total"]}"/><w:tblLayout w:type="{c["mode"]}"/><w:tblCellMar>'+''.join(f'<w:{s} w:w="0" w:type="dxa"/>' for s in ['top','left','bottom','right'])+'</w:tblCellMar></w:tblPr><w:tblGrid>'+''.join(f'<w:gridCol w:w="{w}"/>' for w in c['grid'])+'</w:tblGrid><w:tr>'+''.join(f'<w:tc><w:tcPr><w:tcW w:type="pct" w:w="{c["prefs"][j]}"/></w:tcPr>'+p(c['text'][j])+'</w:tc>' for j,w in enumerate(c['grid']))+'</w:tr></w:tbl>'+p('Tail')
body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()
with ZipFile(DEST/'percentages.docx','w',ZIP_DEFLATED) as z:
 for n,v in parts.items():z.writestr(n,v)
import json
(DEST/'percentages-cases.json').write_text(json.dumps(cases,indent=2))
