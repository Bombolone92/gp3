from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
from xml.etree import ElementTree as ET
import sys
ROOT=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
def p(text, page=False):
    return '<w:p><w:pPr>'+('<w:pageBreakBefore/>' if page else '')+'<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:t>'+escape(text)+'</w:t></w:r></w:p>'
def edge(side,style,color='00AA00'):
    return '' if style=='omitted' else f'<w:{side} w:val="{style}"'+(' w:sz="24" w:color="'+color+'"' if style=='single' else '')+'/>'
def fixture_parts():
    body=''; cases=[]
    for orientation in ['horizontal','vertical']:
        for first,second in [('nil','single'),('single','nil'),('nil','nil'),('nil','none'),('none','nil'),('nil','omitted')]:
            name=f'{orientation}-{first}-{second}';cases.append(name);body+=p(name,len(cases)>1)
            borders=''.join(edge(s,'single','000000') for s in ['top','left','bottom','right'])+edge('insideH','single','0000FF')+edge('insideV','single','0000FF')
            grid='<w:gridCol w:w="2160"/>'*(2 if orientation=='vertical' else 1)
            body+=f'<w:tbl><w:tblPr><w:tblW w:w="{4320 if orientation=="vertical" else 2160}" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>{grid}</w:tblGrid><w:tr>'
            for i,style in enumerate([first,second]):
                if i and orientation=='horizontal':body+='</w:tr><w:tr>'
                side=('bottom' if i==0 else 'top') if orientation=='horizontal' else ('right' if i==0 else 'left')
                body+='<w:tc><w:tcPr><w:tcW w:w="2160" w:type="dxa"/>'+('<w:tcBorders>'+edge(side,style)+'</w:tcBorders>' if style!='omitted' else '')+'</w:tcPr>'+p('First' if i==0 else 'Second')+'</w:tc>'
            body+='</w:tr></w:tbl>'+p('After')
    parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>', '_rels/.rels':f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>', 'word/_rels/document.xml.rels':f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>', 'word/settings.xml':f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>', 'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>'+body+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'}
    return parts

def generate():
    path=ROOT/'public/fixtures/nil-border-conflicts.docx'
    with ZipFile(path,'w',ZIP_DEFLATED) as archive:
        for name,xml in fixture_parts().items():archive.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+xml)
    print(path)

def verify(path):
    with ZipFile(ROOT/'public/fixtures/nil-border-conflicts.docx') as source,ZipFile(path) as exported:
        assert set(source.namelist())==set(exported.namelist())
        for name in source.namelist():
            if name!='word/document.xml':assert source.read(name)==exported.read(name),name
        before=ET.fromstring(source.read('word/document.xml'));after=ET.fromstring(exported.read('word/document.xml'))
    ns={'w':W}
    props=lambda root:[ET.tostring(node) for node in root.findall('.//w:tcPr',ns)]
    assert props(before)==props(after),'Cell border declarations changed'
    assert [ET.tostring(node) for node in before.findall('.//w:tblPr',ns)]==[ET.tostring(node) for node in after.findall('.//w:tblPr',ns)]
    original=''.join(before.itertext());updated=''.join(after.itertext())
    assert updated==original.replace('First','FirstX',1),'Unexpected text edit'
    assert len(after.findall('.//w:tbl',ns))==12
    print('PASS independent nil/visible declarations, table structure, text edit and unrelated parts:',path)

if __name__=='__main__':
    if sys.argv[1:]==['--check-exports']:
        paths=list((ROOT/'test-results').glob('nil-border-conflicts-*/nil-border-conflicts.docx'))
        assert paths,'Missing browser nil-border export'
        for path in paths:verify(path)
    elif len(sys.argv)>1:verify(Path(sys.argv[1]))
    else:generate()
