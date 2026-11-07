"""Original XML controls for contextual spacing across physical table rows."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from canvas_first_section_fixture import parts as base,W,R,CT
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/cell-row-context'
folder.mkdir(exist_ok=True)
parts=dict(base);body=[]
for i,(alignment,columns,numbering) in enumerate((a,c,n) for a in ['top','center','bottom'] for c in [1,2] for n in ['none','direct','style']):
 rows=[]
 for r in range(3):
  cells=[]
  for c in range(columns):
   num='<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' if numbering=='direct' else ''
   style='List' if numbering=='style' else 'Shared'
   cells.append(f'<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/><w:vAlign w:val="{alignment}"/></w:tcPr><w:p><w:pPr><w:pStyle w:val="{style}"/>{num}</w:pPr><w:r><w:t>C{i}R{r}C{c}</w:t></w:r></w:p></w:tc>')
  rows.append('<w:tr><w:trPr><w:trHeight w:val="800" w:hRule="exact"/></w:trPr>'+''.join(cells)+'</w:tr>')
 borders=''.join(f'<w:{s} w:val="single" w:sz="4"/>' for s in ['top','left','bottom','right','insideH','insideV'])
 body.append(f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if i else ""}</w:pPr><w:r><w:t>Case {i}</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblW w:w="{columns*2400}" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>{"<w:gridCol w:w=\"2400\"/>"*columns}</w:tblGrid>{"".join(rows)}</w:tbl>')
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}<w:p/><w:sectPr><w:pgSz w:w="7200" w:h="9000"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>'
parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Shared"><w:name w:val="Shared"/><w:pPr><w:spacing w:before="120" w:after="0"/><w:contextualSpacing/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="List"><w:name w:val="List"/><w:basedOn w:val="Shared"/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style></w:styles>'
parts['word/numbering.xml']=f'<w:numbering xmlns:w="{W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="-"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="360"/></w:tabs><w:ind w:left="360" w:hanging="180"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
for n in ['settings','numbering']:
 parts['word/_rels/document.xml.rels']=parts['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="{n}" Type="{R}/{n}" Target="{n}.xml"/></Relationships>')
 parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>',f'<Override PartName="/word/{n}.xml" ContentType="{CT}{n}+xml"/></Types>')
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
