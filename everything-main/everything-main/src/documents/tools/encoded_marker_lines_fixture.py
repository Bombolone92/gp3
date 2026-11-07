"""Original encoded-marker automatic-line controls."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from canvas_first_section_fixture import parts,W,R,CT
import json
out=Path(__file__).resolve().parents[1]/'tests/fixtures/encoded-marker-lines';out.mkdir(exist_ok=True)
levels=[];paras=[];cases=[]
for body in ['Franklin Gothic Book','Arial']:
 for face,label,size in [('Symbol','\uf0b7',10),('Symbol','\uf0b7',20),('Symbol','•',20),('Arial','•',10)]:
  for line in [180,240,360]:
   i=len(cases);id=f'C{i:02d}';props=f'<w:rFonts w:ascii="{body}" w:hAnsi="{body}"/><w:sz w:val="20"/>'
   levels.append(f'<w:abstractNum w:abstractNumId="{i}"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="{label}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="{face}" w:hAnsi="{face}"/><w:sz w:val="{size*2}"/></w:rPr></w:lvl></w:abstractNum>')
   paras.append(f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if i else ""}<w:numPr><w:ilvl w:val="0"/><w:numId w:val="{i+1}"/></w:numPr><w:spacing w:before="0" w:after="0" w:line="{line}" w:lineRule="auto"/><w:rPr>{props}</w:rPr></w:pPr><w:r><w:rPr>{props}</w:rPr><w:t>{id} first</w:t><w:br/><w:t>{id} second</w:t><w:br/><w:t>{id} third</w:t></w:r></w:p><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:rPr>{props}</w:rPr></w:pPr><w:r><w:rPr>{props}</w:rPr><w:t>{id} after</w:t></w:r></w:p>')
   cases.append(dict(id=id,body=body,marker=face,label=label,size=size,line=line))
parts['word/numbering.xml']=f'<w:numbering xmlns:w="{W}">'+''.join(levels)+''.join(f'<w:num w:numId="{i+1}"><w:abstractNumId w:val="{i}"/></w:num>' for i in range(len(cases)))+'</w:numbering>'
parts['word/_rels/document.xml.rels']=parts['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="num" Type="{R}/numbering" Target="numbering.xml"/></Relationships>')
parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>',f'<Override PartName="/word/numbering.xml" ContentType="{CT}numbering+xml"/></Types>')
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(paras)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
with ZipFile(out/'encoded-marker-lines.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
