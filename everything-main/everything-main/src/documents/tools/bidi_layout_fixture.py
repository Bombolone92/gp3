"""Original run-order, wrapping, tab and Arabic-ligature controls."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
import json
repo=Path(__file__).resolve().parents[1]
root=repo/'tests/fixtures/bidi-layout';root.mkdir(exist_ok=True)
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(repo/'tests/fixtures/rtl-runs/control.docx') as z:
    parts={name:z.read(name) for name in z.namelist()}
texts=['ABC def','012 345','٠١٢ ٣٤٥','אבג דהו','مرحبا بالعالم','ABC (אבג) 123','٠']
cases=[dict(text=text,rtl=rtl) for text in texts for rtl in [False,True]]
cases += [dict(text='אבג דהו זחט יכל 012 345 678',rtl=True,width=110),
          dict(text='ABC אבג DEF דהו GHI 012 JKL',rtl=True,width=110),
          dict(text='אבג\tדהו\t012',rtl=True),dict(text='لا لام',rtl=True)]
body=[]
for i,case in enumerate(cases):
    case.update(index=i,label=f'Case {i+1}: '+('RTL' if case['rtl'] else 'LTR'))
    br='<w:pageBreakBefore/>' if i and i%7==0 else ''
    body.append(f'<w:p><w:pPr>{br}<w:spacing w:before="0" w:after="120" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:t>{case["label"]}</w:t></w:r></w:p>')
    indent=f'<w:ind w:right="{(468-case["width"])*20}"/>' if 'width' in case else ''
    text='<w:tab/>'.join(f'<w:t xml:space="preserve">{escape(t)}</w:t>' for t in case['text'].split('\t'))
    body.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="360" w:line="480" w:lineRule="exact"/>{indent}</w:pPr><w:r><w:t xml:space="preserve">Left [ </w:t></w:r><w:r><w:rPr><w:rtl w:val="{int(case["rtl"])}"/></w:rPr>{text}</w:r><w:r><w:t xml:space="preserve"> ] Right</w:t></w:r></w:p>')
body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>')
parts['word/document.xml']=f'<w:document xmlns:w="{w}"><w:body>{"".join(body)}</w:body></w:document>'.encode()
parts['word/styles.xml']=f'<w:styles xmlns:w="{w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>'.encode()
with ZipFile(root/'control.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items():z.writestr(name,data)
(root/'cases.json').write_text(json.dumps(cases,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print(root/'control.docx')
