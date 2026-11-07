from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
from canvas_first_section_fixture import parts,W,R,REL,CT
levels=[];paras=[];cases=[]
for font, label in [('Symbol','\uf0b7'),('Symbol','•'),('Arial','•')]:
 for size in [10,20]:
  for bold,italic in [(False,False),(True,False),(False,True),(True,True)]:
   i=len(cases);ident=f'S{i:02d}'
   props=f'<w:rFonts w:ascii="{font}" w:hAnsi="{font}"/><w:b w:val="{int(bold)}"/><w:i w:val="{int(italic)}"/><w:sz w:val="{size*2}"/>'
   levels.append(f'<w:abstractNum w:abstractNumId="{i}"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:suff w:val="tab"/><w:lvlText w:val="{label}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="720"/></w:pPr><w:rPr>{props}</w:rPr></w:lvl></w:abstractNum>')
   paras.append(f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if i==12 else ""}<w:numPr><w:ilvl w:val="0"/><w:numId w:val="{i+1}"/></w:numPr><w:spacing w:before="0" w:after="0" w:line="800" w:lineRule="exact"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr><w:t>{ident} {font} {size} {"PUA" if label==chr(0xf0b7) else "Unicode"} {bold=} {italic=}</w:t></w:r></w:p>')
   cases.append(dict(id=ident,font=font,size=size,bold=bold,italic=italic,label=label,page=i//12))
parts['word/numbering.xml']=f'<w:numbering xmlns:w="{W}">'+''.join(levels)+''.join(f'<w:num w:numId="{i+1}"><w:abstractNumId w:val="{i}"/></w:num>' for i in range(len(cases)))+'</w:numbering>'
parts['word/_rels/document.xml.rels']=parts['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="num" Type="{R}/numbering" Target="numbering.xml"/></Relationships>')
parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>',f'<Override PartName="/word/numbering.xml" ContentType="{CT}numbering+xml"/></Types>')
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(paras)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
root=Path(__file__).resolve().parents[1]
out=root/'public/fixtures/symbol-bullet.docx'
with ZipFile(out,'w',ZIP_DEFLATED) as z:
 for name,text in parts.items():z.writestr(name,text)
(root/'tests/fixtures/symbol-bullet/cases.json').write_text(json.dumps(cases,indent=2)+'\n')
