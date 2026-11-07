"""Original regular/bold/italic controls for reviewed variable font families."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
with ZipFile(root/'public/fixtures/reviewed-font.docx') as z: parts={n:z.read(n) for n in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
cases=[('Oswald',24,False,False,'REGULAR CONDENSED HEADING'),('Oswald',24,True,False,'BOLD CONDENSED HEADING')]
for bold,italic,label in [(False,False,'Regular'),(True,False,'Bold'),(False,True,'Italic'),(True,True,'Bold italic')]:
    cases.append(('Open Sans',14,bold,italic,label+' body: original font controls compare flowing words, punctuation, and numbers 12345. Alpha beta gamma delta epsilon zeta eta theta.'))
body=[]
for family,size,bold,italic,text in cases:
    font=f'<w:rFonts w:ascii="{family}" w:hAnsi="{family}"/>'+('<w:b/>' if bold else '')+('<w:i/>' if italic else '')+f'<w:sz w:val="{size*2}"/>'
    body.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="120" w:line="240" w:lineRule="auto"/><w:rPr>{font}</w:rPr></w:pPr><w:r><w:rPr>{font}</w:rPr><w:t>{text}</w:t></w:r></w:p>')
section='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}{section}</w:body></w:document>'.encode()
with ZipFile(root/'public/fixtures/reviewed-family.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items():z.writestr(name,data)
