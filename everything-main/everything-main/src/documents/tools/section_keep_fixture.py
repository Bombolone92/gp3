"""Original controls for keep-with-next before an empty section boundary."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
root=Path(__file__).resolve().parents[1]/'tests/fixtures/section-keep'
root.mkdir(exist_ok=True)
with ZipFile(root.parent/'book-fold/absent.docx') as z:
    base={name:z.read(name) for name in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
cases=[dict(name='empty-keep'),dict(name='empty-free',keep=False),dict(name='empty-zero',after=0),dict(name='text-keep',boundary='BOUNDARY'),dict(name='text-free',boundary='BOUNDARY',keep=False),dict(name='table-empty',table=True),dict(name='continuous-empty',kind='continuous'),dict(name='continuous-text',kind='continuous',boundary='BOUNDARY'),dict(name='empty-target',target=''),dict(name='chain',keepIntro=True)]
def section(kind='nextPage'):
    return f'<w:sectPr><w:type w:val="{kind}"/><w:pgSz w:w="8640" w:h="4800"/><w:pgMar w:top="480" w:right="480" w:bottom="480" w:left="480" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
def paragraph(text,height,after=0,keep=False,boundary=False):
    props=('<w:keepNext/>' if keep else '')+f'<w:spacing w:before="0" w:after="{after*20}" w:line="{height*20}" w:lineRule="exact"/>'+(section() if boundary else '')
    run=f'<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr><w:t>{text}</w:t></w:r>' if text else ''
    return f'<w:p><w:pPr>{props}</w:pPr>{run}</w:p>'
for case in cases:
    body=paragraph('INTRO',144,keep=case.get('keepIntro',False))
    if case.get('table'):
        body='<w:tbl><w:tblPr><w:tblW w:w="7680" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar>'+''.join(f'<w:{side} w:w="0" w:type="dxa"/>' for side in ['top','left','bottom','right'])+'</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="7680"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="7680" w:type="dxa"/></w:tcPr>'+body+'</w:tc></w:tr></w:tbl>'
    body+=paragraph(case.get('target','TARGET'),18,case.get('after',60),case.get('keep',True))
    body+=paragraph(case.get('boundary',''),12,boundary=True)
    body+=paragraph('AFTER',18)+section(case.get('kind','nextPage'))
    parts={**base,'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()}
    with ZipFile(root/(case['name']+'.docx'),'w',ZIP_DEFLATED) as z:
        for name,data in parts.items():
            info=ZipInfo(name,(2026,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
(root/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf8')
