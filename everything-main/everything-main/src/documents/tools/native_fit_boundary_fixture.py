"""Independent narrow-cell line-fit control. Regeneration requires native recapture."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import json
root=Path(__file__).resolve().parents[1]
dest=root/'tests/fixtures/native-fit-boundary';dest.mkdir(exist_ok=True)
with ZipFile(root/'tests/fixtures/table-row-keep-next/none.docx') as z: parts={n:z.read(n) for n in z.namelist()}
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
body=''
cases=[]
for mode in ['fixed','autofit']:
 for width in [2850,2860,2870,2875,2880,2881,2882,2885,2890,2900]:
  i=len(cases)+1;cases.append(dict(mode=mode,width=width))
  body+=f'<w:p><w:r><w:t>Case {i}: {mode} {width}</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblW w:w="{width}" w:type="dxa"/><w:tblLayout w:type="{mode}"/><w:tblCellMar>'+''.join(f'<w:{s} w:w="0" w:type="dxa"/>' for s in ['top','left','bottom','right'])+f'</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="{width}"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="40"/><w:kern w:val="2"/></w:rPr><w:t>OPERATIONAL PLAN</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
body+='<w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=f'<w:document xmlns:w="{w}"><w:body>{body}</w:body></w:document>'.encode()
with ZipFile(dest/'control.docx','w',ZIP_DEFLATED) as z:
 for n,v in parts.items(): z.writestr(n,v)
(dest/'cases.json').write_text(json.dumps(cases))
