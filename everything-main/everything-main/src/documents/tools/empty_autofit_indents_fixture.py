from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import json
from canvas_first_section_fixture import parts,W,R,CT
out=Path(__file__).resolve().parents[1]/'tests/fixtures/empty-autofit-indents';out.mkdir(exist_ok=True)
cases=[('empty','', ''),('left','w:left="540"',''),('right','w:right="540"',''),('first','w:firstLine="540"',''),('hanging','w:left="540" w:hanging="540"',''),('both','w:left="540" w:right="540"',''),('space','w:left="540"','<w:t xml:space="preserve"> </w:t>'),('tab','w:left="540"','<w:tab/>'),('break','w:left="540"','<w:br/>'),('text','w:left="540"','<w:t>X</w:t>')]
body=[]
for i,(name,ind,text) in enumerate(cases):
 ppr=f'<w:pPr><w:spacing w:after="0"/>{"<w:ind "+ind+"/>" if ind else ""}</w:pPr>'
 cells=''
 for width,fill,content in [(2000,'FF0000','<w:p><w:r><w:t>A</w:t></w:r></w:p>'),(200,'00FF00',f'<w:p>{ppr}<w:r>{text}</w:r></w:p>'),(2000,'0000FF','<w:p><w:r><w:t>B</w:t></w:r></w:p>')]:
  cells+=f'<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="{width}"/><w:shd w:val="clear" w:fill="{fill}"/></w:tcPr>{content}</w:tc>'
 body.append(f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if i else ""}</w:pPr><w:r><w:t>{name}</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblW w:w="4200" w:type="dxa"/><w:tblCellMar><w:left w:w="40" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="200"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr>{cells}</w:tr></w:tbl>')
parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}<w:p/><w:sectPr><w:pgSz w:w="7200" w:h="8000"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>'
with ZipFile(out/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(out/'cases.json').write_text(json.dumps(cases,indent=2))
