"""Independent original OPC/XML fixture for hyperlinks in temporary controls.

Uses only Python's standard library. No editor code or external artwork.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as E
from html import escape
import sys
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
SOURCE=Path(__file__).resolve().parents[1]/'public/fixtures/control-hyperlinks.docx'
def run(text, properties=''):
    return '<w:r>'+('<w:rPr>'+properties+'</w:rPr>' if properties else '')+'<w:t xml:space="preserve">'+escape(text)+'</w:t></w:r>'
def link(text, rid='mail', **attrs):
    return '<w:hyperlink '+('r:id="'+rid+'" ' if rid else '')+' '.join('w:'+k+'="'+escape(v)+'"' for k,v in attrs.items())+'>'+run(text)+'</w:hyperlink>'
def control(ident,content,placeholder=False):
    return '<w:sdt><w:sdtPr><w:id w:val="'+str(ident)+'"/><w:temporary/>'+('<w:showingPlcHdr/>' if placeholder else '')+'<w:richText/>'+'</w:sdtPr><w:sdtEndPr/><w:sdtContent>'+content+'</w:sdtContent></w:sdt>'
def generate():
    mail='<w:hyperlink r:id="mail" w:tooltip="Write to us" w:history="true">'+run('Mail ')+run('á😀','<w:i/>')+'</w:hyperlink>'
    first=control(71,run('Contact ')+mail+run(' or ')+link('Web','web'))
    second=control(72,link('Jump',None,anchor='Destination')+run(' / ')+link('Also mail'))
    body='<w:p>'+run('Links inside controls')+'</w:p><w:p>'+link('Before link')+run(' ')+first+run(' ')+second+run(' ')+link('After link')+'</w:p><w:p>'+control(73,link('[Email]'),True)+'</w:p><w:p><w:bookmarkStart w:id="7" w:name="Destination"/>'+run('Destination text')+'<w:bookmarkEnd w:id="7"/></w:p>'
    parts={
      '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      '_rels/.rels':f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/_rels/document.xml.rels':f'<Relationships xmlns="{REL}"><Relationship Id="mail" Type="{R}/hyperlink" Target="mailto:hello@example.com" TargetMode="External"/><Relationship Id="web" Type="{R}/hyperlink" Target="https://example.com/guide" TargetMode="External"/></Relationships>',
      'word/document.xml':f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>'+body+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'}
    with ZipFile(SOURCE,'w',ZIP_DEFLATED) as z:
        for n,s in parts.items():z.writestr(n,'<?xml version="1.0" encoding="UTF-8"?>'+s)
def verify(path):
    ns={'w':W,'r':R}
    with ZipFile(SOURCE) as a,ZipFile(path) as b:
        assert set(a.namelist())==set(b.namelist())
        for n in a.namelist():
            if n!='word/document.xml':assert a.read(n)==b.read(n),n
        before,after=[E.fromstring(z.read('word/document.xml')) for z in [a,b]]
    assert ''.join(before.itertext())==''.join(after.itertext())
    signature=lambda root:[(n.attrib,''.join(n.itertext())) for n in root.findall('.//w:hyperlink',ns)]
    assert signature(before)==signature(after)
    controls=after.findall('.//w:sdt',ns);assert len(controls)==3
    link=controls[0].find('w:sdtContent/w:hyperlink',ns)
    assert ''.join(link.itertext())=='Mail á😀'
    assert link.find('w:r/w:rPr/w:b',ns) is not None
    assert link.find('w:r/w:rPr/w:sz',ns).get('{'+W+'}val')=='30'
    print('PASS retained controls, nested hyperlinks, targets and source text with changed formatting:',path)
if __name__=='__main__':
    if len(sys.argv)==1:generate()
    else:
        for p in sys.argv[1:]:verify(p)
