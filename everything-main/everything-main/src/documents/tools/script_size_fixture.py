"""Independent mixed-run controls for the reduced script size."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/script-size'
folder.mkdir(exist_ok=True)
base=folder.parent/'book-fold/absent.docx'
with ZipFile(base) as z:parts={n:z.read(n) for n in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
body=[];cases=[]
for family in ['Garamond','Arial','Times New Roman']:
    for face in ['regular','bold','italic']:
        label=family+' '+face
        body.append(f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if cases else ""}<w:spacing w:after="0"/></w:pPr><w:r><w:t>{label}</w:t></w:r></w:p>')
        rows=[]
        for size in [8,10,11,12,16,20]:
            for script in ['superscript','subscript']:
                runs=[]
                for text,active in [('START ',False),('TEST',True),(' END',False)]:
                    props=f'<w:rFonts w:ascii="{family}" w:hAnsi="{family}"/>'+('<w:b/>' if face=='bold' else '<w:i/>' if face=='italic' else '')+f'<w:sz w:val="{size*2}"/>'+ (f'<w:vertAlign w:val="{script}"/>' if active else '')
                    runs.append(f'<w:r><w:rPr>{props}</w:rPr><w:t xml:space="preserve">{text}</w:t></w:r>')
                body.append('<w:p><w:pPr><w:spacing w:after="0" w:line="720" w:lineRule="exact"/></w:pPr>'+''.join(runs)+'</w:p>')
                rows.append(dict(size=size,script=script))
        cases.append(dict(family=family,face=face,rows=rows))
body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'.encode()
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items():
        info=ZipInfo(name,(2026,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
