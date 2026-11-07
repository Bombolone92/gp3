from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import sys
repo=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(repo/'tools'))
root=repo/'tests/fixtures/row-keep-fitting'
root.mkdir(exist_ok=True)
from canvas_first_section_fixture import parts as base,W
for keep in [False,True]:
 def p(text,n=1,k=False,after=12):return '<w:p><w:pPr>'+('<w:keepNext/>'if k else '')+f'<w:spacing w:before="0" w:after="{after*20}" w:line="280" w:lineRule="exact"/></w:pPr><w:r>'+''.join(('<w:br/>'if i else '')+f'<w:t>{text} {i+1}</w:t>'for i in range(n))+'</w:r></w:p>'
 def cell(content,width):return f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/></w:tcPr>{content}</w:tc>'
 parts=dict(base);parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>'
 parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body><w:p><w:pPr><w:spacing w:line="9764" w:lineRule="exact" w:after="0"/></w:pPr><w:r><w:t>Spacer</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="7360"/></w:tblGrid><w:tr>{cell(p("Heading",1,keep),2000)}{cell(p("First",8)+p("Second",2)+p("Third",5),7360)}</w:tr><w:tr>{cell(p("Footer",after=0),2000)}{cell(p("End",after=0),7360)}</w:tr></w:tbl><w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:bottom="0" w:left="1440" w:right="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>'
 with ZipFile(root/f'tight-{int(keep)}.docx','w',ZIP_DEFLATED)as z:
  for n,b in parts.items():z.writestr(n,b)

# Independently vary only the following row's first-line height.
from xml.etree import ElementTree as E
for size in [1,4,40]:
 with ZipFile(root/'tight-1.docx') as z,ZipFile(root/f'next-{size}.docx','w',ZIP_DEFLATED) as out:
  for item in z.infolist():
   data=z.read(item.filename)
   if item.filename=='word/document.xml':
    document=E.fromstring(data)
    row=document.find('.//{'+W+'}tbl').findall('{'+W+'}tr')[1]
    for spacing in row.iter('{'+W+'}spacing'):spacing.set('{'+W+'}line',str(size*20))
    data=E.tostring(document)
   out.writestr(item,data)
