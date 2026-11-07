"""Original saved building-block content controls, independent of the corpus."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
root=Path(__file__).resolve().parents[1];target=root/'tests/fixtures/docpart-object';target.mkdir(exist_ok=True)
with ZipFile(root/'tests/fixtures/inactive-note-marks/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
def run(t):return '<w:r><w:t xml:space="preserve">'+t+'</w:t></w:r>'
def p(t):return '<w:p>'+run(t)+'</w:p>'
def control(i,properties,content):return f'<w:sdt><w:sdtPr><w:alias w:val="Object {i}"/><w:id w:val="{i}"/><w:docPartObj>{properties}</w:docPartObj></w:sdtPr><w:sdtContent>{content}</w:sdtContent></w:sdt>'
body=p('Saved building-block controls')
body+=control(1,'<w:docPartGallery w:val="Table of Contents"/><w:docPartCategory w:val="General"/><w:docPartUnique/>',p('Alpha saved contents')+p('Second saved paragraph'))
body+=control(2,'',p('Beta empty metadata'))
body+='<w:p>'+run('Inline before ')+control(3,'<w:docPartGallery w:val="Custom Gallery"/><w:docPartUnique w:val="false"/>',run('Gamma inline contents'))+run(' after')+'</w:p>'
body+=control(4,'<w:docPartCategory w:val="Custom Category"/><w:docPartUnique w:val="0"/>',p('Delta category only'))
body+=p('Following paragraph')
parts['word/document.xml']=(f'<w:document xmlns:w="{W}"><w:body>'+body+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>').encode()
with ZipFile(target/'control.docx','w',ZIP_DEFLATED) as z:
    for n,b in parts.items():z.writestr(n,b)
print(target/'control.docx')
