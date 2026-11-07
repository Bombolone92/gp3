"""Original XML control for local-face weight boundaries; no engine serialization."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
with ZipFile(root/'tests/fixtures/synthetic-bold-advance/modern.docx') as z:
    parts={name:z.read(name) for name in z.namelist()}
paragraphs=[]
for family in ['Segoe UI Semibold','Segoe UI Semilight','Franklin Gothic Medium','Dubai Medium']:
    for bold in [False,True]:
        props=f'<w:rFonts w:ascii="{family}" w:hAnsi="{family}"/><w:kern w:val="0"/><w:sz w:val="48"/>'+('<w:b/>' if bold else '')
        paragraphs.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="840" w:lineRule="exact"/></w:pPr><w:r><w:rPr>{props}</w:rPr><w:t>{family} {"bold" if bold else "regular"}</w:t></w:r></w:p>')
parts['word/document.xml']=('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+''.join(paragraphs)+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>').encode()
with ZipFile(root/'tests/fixtures/synthetic-bold/weights.docx','w') as z:
    for name,data in parts.items():
        info=ZipInfo(name, (2026, 9, 25, 5, 20, 54));info.create_system=0;info.external_attr=0o600<<16
        z.writestr(info,data,compress_type=ZIP_DEFLATED)
