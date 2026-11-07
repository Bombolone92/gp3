"""Independently authored OOXML controls for typing after Enter at paragraph end."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/package/2006/relationships'
CT='http://schemas.openxmlformats.org/package/2006/content-types'
P='<w:p><w:pPr><w:rPr><w:b w:val="0"/><w:i w:val="0"/></w:rPr></w:pPr><w:r><w:t xml:space="preserve">Plain </w:t></w:r><w:r><w:rPr><w:b/><w:i/><w:color w:val="2244AA"/></w:rPr><w:t>Styled tail</w:t></w:r></w:p>'
def build():
 out={}
 for mode in ['body','toggle-cell','toggle-body','partial-body']:
  p=P if mode=='body' else '<w:p><w:pPr><w:rPr><w:b w:val="0"/><w:i/></w:rPr></w:pPr>'+('<w:r><w:t xml:space="preserve">Prefix </w:t></w:r>' if mode=='partial-body' else '')+'<w:r><w:rPr><w:i/></w:rPr><w:t>Styled tail</w:t></w:r></w:p>'
  body=p if mode.endswith('body') else '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="6000" w:type="dxa"/></w:tcPr>'+p+'</w:tc></w:tr></w:tbl><w:p><w:r><w:t>End sentinel</w:t></w:r></w:p>'
  parts={
   '[Content_Types].xml':f'<Types xmlns="{CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
   '_rels/.rels':f'<Relationships xmlns="{R}"><Relationship Id="rDocument" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
   'word/_rels/document.xml.rels':f'<Relationships xmlns="{R}"><Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
   'word/styles.xml':f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr/></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>',
   'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'}
  out[mode]={k:v.encode() for k,v in parts.items()}
 return out
if __name__=='__main__':
 folder=Path('tests/fixtures/paragraph-end-typing');folder.mkdir(parents=True,exist_ok=True)
 for mode,parts in build().items():
  with ZipFile(folder/(mode+'.docx'),'w') as z:
   for name,data in parts.items():
    info=ZipInfo(name,(2026,10,5,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
