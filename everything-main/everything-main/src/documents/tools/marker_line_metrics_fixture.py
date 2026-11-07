from zipfile import ZipFile,ZIP_DEFLATED
from pathlib import Path
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
rels='http://schemas.openxmlformats.org/package/2006/relationships'
ROOT=Path(__file__).resolve().parents[1]
with ZipFile(ROOT / 'public/fixtures/native-line-metrics.docx') as z: parts={n:z.read(n) for n in z.namelist()}
levels=[];paras=[]
for i,(face,kind,label) in enumerate([('Symbol','bullet','•'),('Arial','bullet','•'),('Arial','decimal','%1.'),('Courier New','bullet','•')],1):
 levels.append(f'<w:abstractNum w:abstractNumId="{i}"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="{kind}"/><w:lvlText w:val="{label}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="360"/></w:tabs><w:ind w:left="360" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="{face}" w:hAnsi="{face}"/><w:sz w:val="40"/></w:rPr></w:lvl></w:abstractNum>')
 props='<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/>'
 paras.append(f'<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="{i}"/></w:numPr><w:spacing w:before="0" w:after="240" w:line="240" w:lineRule="auto"/><w:rPr>{props}</w:rPr></w:pPr><w:r><w:rPr>{props}</w:rPr><w:t>Case {i} first</w:t><w:br/><w:t>Case {i} second</w:t></w:r></w:p>')
parts['word/numbering.xml']=f'<w:numbering xmlns:w="{w}">{"".join(levels)}'+''.join(f'<w:num w:numId="{i}"><w:abstractNumId w:val="{i}"/></w:num>' for i in range(1,5))+'</w:numbering>'
parts['word/_rels/document.xml.rels']=f'<Relationships xmlns="{rels}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>'
parts['[Content_Types].xml']=parts['[Content_Types].xml'].decode().replace('</Types>','<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>')
parts['word/document.xml']=f'<w:document xmlns:w="{w}"><w:body>{"".join(paras)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
with ZipFile(ROOT / 'public/fixtures/marker-line-metrics.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
