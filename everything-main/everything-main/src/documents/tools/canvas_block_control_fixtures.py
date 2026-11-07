"""Original block SDT probes: standard library OPC/XML only."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parents[1] / 'public' / 'fixtures'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.'
def p(text): return '<w:p><w:r><w:t xml:space="preserve">'+escape(text)+'</w:t></w:r></w:p>'
def control(content,identity=41):
    return '<w:sdt><w:sdtPr><w:id w:val="'+str(identity)+'"/><w:temporary/><w:richText/></w:sdtPr><w:sdtEndPr/><w:sdtContent>'+content+'</w:sdtContent></w:sdt>'
def table(content):
    return '<w:tbl><w:tblPr><w:tblW w:w="5760" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="5760"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="5760" w:type="dxa"/></w:tcPr>'+content+'</w:tc></w:tr></w:tbl>'
for location in ['body','cell','cellonly','table','nested','mixed','continuation','empty']:
    block=control(p('Control alpha')+p('Control beta'))
    if location=='empty': block=control('<w:p/>').replace('<w:sdtPr>','<w:sdtPr><w:rPr><w:b/><w:color w:val="2050C0"/></w:rPr>').replace('<w:temporary/>','<w:temporary/><w:showingPlcHdr/>')
    if location=='table': block=control(p('Control alpha')+table(p('Control beta'))+p('Control gamma'))
    if location=='nested': block=control(p('Control alpha')+control(p('Control beta'),42)+p('Control gamma'))
    if location=='mixed': block=control(p('Control alpha')+'<w:p><w:r><w:t xml:space="preserve">Prefix </w:t></w:r>'+control('<w:r><w:t xml:space="preserve">Control beta</w:t></w:r>',42)+'<w:r><w:t xml:space="preserve"> Suffix</w:t></w:r></w:p>'+p('Control gamma'))
    if location=='continuation':
        block=table(p('Control alpha')).replace('</w:tcPr>','<w:vMerge w:val="restart"/></w:tcPr>')
        block=block.replace('</w:tbl>','<w:tr><w:tc><w:tcPr><w:tcW w:w="5760" w:type="dxa"/><w:vMerge/></w:tcPr>'+control('<w:p/>')+'</w:tc></w:tr></w:tbl>')
    if location=='cell': block=table(p('Before cell control')+block+p('After cell control'))
    if location=='cellonly': block=table(block)
    body=p('Before block')+block+p('After block')
    parts={
      '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="'+CT+'document.main+xml"/></Types>',
      '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>'+body+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
    }
    path=OUT/f'block-control-{location}.docx'
    with ZipFile(path,'w',ZIP_DEFLATED) as z:
        for name,xml in parts.items(): z.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+xml)
    print(path)

