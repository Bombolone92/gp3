"""Independent OOXML controls for Montserrat family and Light faces and style modifiers."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
root=Path(__file__).resolve().parents[1]
out=root/'tests/fixtures/montserrat';out.mkdir(exist_ok=True)
with ZipFile(root/'public/fixtures/reviewed-font.docx') as z:parts={n:z.read(n) for n in z.namelist()}
body=[];cases=[]
for family in ['Montserrat','Montserrat Light']:
    for size in [10,12,18]:
        for bold,italic,label in [(False,False,'regular'),(True,False,'bold'),(False,True,'italic'),(True,True,'bold italic')]:
            text=f'{family} {size} {label}: AV fi 012345'
            props=f'<w:rFonts w:ascii="{family}" w:hAnsi="{family}"/>'+('<w:b/>' if bold else '')+('<w:i/>' if italic else '')+f'<w:sz w:val="{size*2}"/>'
            body.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="120" w:line="240" w:lineRule="auto"/><w:rPr>{props}</w:rPr></w:pPr><w:r><w:rPr>{props}</w:rPr><w:t>{text}</w:t></w:r></w:p>')
            cases.append({'family':family,'size':size,'bold':bold,'italic':italic,'text':text})
section='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=f'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{"".join(body)}{section}</w:body></w:document>'.encode()
with ZipFile(out/'styles.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items():
        info=ZipInfo(name,(2026,9,29,12,0,0));info.create_system=0;info.external_attr=0o600<<16;z.writestr(info,data)
(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
