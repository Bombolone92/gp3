"""Original XML controls for repeated AutoFit span preferences."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import json
from canvas_first_section_fixture import parts as base,W,R,CT
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/autofit-repeated-spans'
folder.mkdir(exist_ok=True)
parts=dict(base);body=[];cases=[]
for i,(count,order) in enumerate((n,o) for o in ['before','after'] for n in [0,1,3,6]):
 ident=f'C{i:02d}'
 def cell(text,width,span=1,color=None):
  pr=f'<w:tcW w:w="{width}" w:type="dxa"/>'+(f'<w:gridSpan w:val="{span}"/>' if span>1 else '')+(f'<w:shd w:val="clear" w:fill="{color}"/>' if color else '')
  return f'<w:tc><w:tcPr>{pr}</w:tcPr><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:tc>'
 merged=''.join('<w:tr>'+cell(f'{ident} merged {j}',6600,3)+'</w:tr>' for j in range(count))
 single='<w:tr>'+''.join(cell(f'{ident} column {j}',w,color=c) for j,(w,c) in enumerate([(1400,'FFAAAA'),(4000,'AAFFAA'),(1400,'AAAAFF')]))+'</w:tr>'
 body.append(f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if i else ""}</w:pPr><w:r><w:t>{ident}</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="4000"/><w:gridCol w:w="1000"/></w:tblGrid>{merged+single if order=="before" else single+merged}</w:tbl>')
 cases.append(dict(id=ident,count=count,order=order))
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}<w:p/><w:sectPr><w:pgSz w:w="7440" w:h="10080"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>'
parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'
parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
parts['word/_rels/document.xml.rels']=parts['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>')
parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>',f'<Override PartName="/word/settings.xml" ContentType="{CT}settings+xml"/></Types>')
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(folder/'cases.json').write_text(json.dumps(cases,indent=2),encoding='utf-8')
