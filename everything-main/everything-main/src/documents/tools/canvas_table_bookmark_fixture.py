"""Original table/row bookmark OPC fixtures and independent export checks.

Only Python standard-library XML/ZIP; no third-party document engine or assets.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as E
import sys
ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
NS = {'w': W}
def start(i, name): return f'<w:bookmarkStart w:id="{i}" w:name="{name}"/>'
def end(i): return f'<w:bookmarkEnd w:id="{i}"/>'
def run(text): return '<w:r><w:t xml:space="preserve">'+text+'</w:t></w:r>'
def p(text): return '<w:p>'+run(text)+'</w:p>'
def cell(content, merge=''): return '<w:tc><w:tcPr><w:tcW w:w="2880" w:type="dxa"/>'+ (f'<w:vMerge w:val="{merge}"/>' if merge else '') + '</w:tcPr>'+content+'</w:tc>'
def row(content): return '<w:tr>'+content+'</w:tr>'
def table(content): return '<w:tbl><w:tblPr><w:tblW w:w="5760" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="2880"/><w:gridCol w:w="2880"/></w:tblGrid>'+content+'</w:tbl>'
def generate():
    control = '<w:sdt><w:sdtPr><w:id w:val="21"/><w:temporary/><w:richText/></w:sdtPr><w:sdtEndPr/><w:sdtContent>'+p('Beta')+'</w:sdtContent></w:sdt>'
    main = '<w:p>'+run('Before ')+start(1,'IntoTable')+run('table')+'</w:p>'
    main += table(start(2,'AllRows')+row(start(3,'FirstRow')+cell(p('Alpha'))+start(4,'AcrossRows')+cell(control)+end(3))
                  +row(cell('<w:p>'+run('Ga')+start(7,'Overlap')+run('mma')+'</w:p>')+cell(p('Delta')))+end(4)
                  +start(6,'RowPoint')+end(6)+row(end(7)+cell(p('Epsilon'))+cell('<w:p>'+start(8,'OutOfTable')+run('Zeta')+'</w:p>'))+end(2)+end(1))
    main += p('After table')+end(8)+'<w:p><w:hyperlink w:anchor="FirstRow">'+run('Go to first row')+'</w:hyperlink></w:p>'
    merged = p('Before merges')+table(row(cell(p('Owner'),'restart')+cell(p('Peer'),'restart'))+start(10,'MergedRow')
                  +row(start(11,'MergedCells')+cell(p(''),'continue')+start(12,'ContinuationPoint')+end(12)+cell(p(''),'continue')+end(11))+end(10)
                  +row(cell(p('Next'))+cell(p('Tail'))))+p('After merges')
    for name,body in [('table-bookmarks',main),('table-bookmarks-merged',merged)]:
        parts = {
          '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
          '_rels/.rels':f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
          'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>'+body+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'}
        path = ROOT/'public/fixtures'/f'{name}.docx'
        with ZipFile(path,'w',ZIP_DEFLATED) as z:
            for part,xml in parts.items(): z.writestr(part,'<?xml version="1.0" encoding="UTF-8"?>'+xml)
        print(path)
def marker_structure(root):
    result=[]
    def walk(n, path):
        for index,c in enumerate(n):
            tag=c.tag.split('}')[-1]
            if tag in ['bookmarkStart','bookmarkEnd']: result.append((path,index,tag,dict(c.attrib)))
            walk(c,path+'/'+tag+'['+str(index)+']')
    walk(root,'document')
    return result

def verify(path):
    with ZipFile(ROOT/'public/fixtures'/path.name) as a, ZipFile(path) as b:
        assert set(a.namelist())==set(b.namelist())
        for name in a.namelist():
            if name!='word/document.xml': assert a.read(name)==b.read(name),name
        before,after=[E.fromstring(z.read('word/document.xml')) for z in [a,b]]
    replacement=('Alpha','AlXpha') if path.name=='table-bookmarks.docx' else ('Next','NeXxt')
    assert ''.join(after.itertext())==''.join(before.itertext()).replace(*replacement,1)
    assert marker_structure(before)==marker_structure(after),'Marker ordering, parent or boundary changed'
    for tag in ['tblPr','tblGrid','trPr','tcPr','sdt']:
        assert [E.tostring(n) for n in before.findall('.//w:'+tag,NS)]==[E.tostring(n) for n in after.findall('.//w:'+tag,NS)],tag
    print('PASS independent table/row marker placement, text edit, controls and package parts:',path)
if __name__=='__main__':
    if len(sys.argv)==1: generate()
    else:
        for value in sys.argv[1:]: verify(Path(value))
