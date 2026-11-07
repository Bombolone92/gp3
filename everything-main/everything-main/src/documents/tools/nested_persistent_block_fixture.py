"""Independent nested block-control editing probes, manually authored XML."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/nested-persistent-blocks';folder.mkdir(exist_ok=True)
with ZipFile(root/'tests/fixtures/docpart-object/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
def p(t):return '<w:p><w:r><w:t xml:space="preserve">'+t+'</w:t></w:r></w:p>'
def control(i,name,content,temporary=False):return f'<w:sdt><w:sdtPr><w:alias w:val="{name}"/><w:id w:val="{i}"/>'+('<w:temporary/>' if temporary else '')+'<w:richText/></w:sdtPr><w:sdtContent>'+content+'</w:sdtContent></w:sdt>'
body=''
for i,name in enumerate(['insert','delete-inner','split','replace-outer','delete-outer','temporary-inner','temporary-outer']):
 inner=control(2*i+2,name+' inner',p('Alpha beta'),name=='temporary-inner')
 body+=p('Before '+name)+control(2*i+1,name+' outer',p('Leading paragraph')+inner+p('Trailing paragraph'),name=='temporary-outer')+p('After '+name)
parts['word/document.xml']=(f'<w:document xmlns:w="{W}"><w:body>'+body+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>').encode()
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
print(folder/'control.docx')
