"""Independent OOXML controls for numeric font choice in directional runs."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from xml.sax.saxutils import escape
import json
repo=Path(__file__).resolve().parents[1]
root=repo/'tests/fixtures/rtl-font-context';root.mkdir(exist_ok=True)
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(repo/'tests/fixtures/rtl-runs/control.docx') as z:
    parts={n:z.read(n) for n in z.namelist()}
texts=['012','012 345','ABC 012','012 ABC','אבג 012','012 אבג','مرحبا 012','012 مرحبا',
       'ABC אבג 012','אבג ABC 012','ABC 012 ٠','٠ 012','۰۱۲','ABC ۰۱۲','אבג ۰۱۲','مرحبا ۰۱۲',
       'ABC 12.5%','אבג 12.5%']
cases=[dict(text=t,flag='rtl',parts=[t]) for t in texts]
cases += [dict(text=texts[i],flag='cs',parts=[texts[i]]) for i in [0,2,4,6]]
cases += [dict(text=a+b,flag='rtl',parts=[a,b]) for a,b in [('ABC ','012'),('אבג ','012'),('مرحبا ','012'),('ABC',' 012')]]
cases += [dict(text=t,flag='rtl',parts=[t]) for t in ['אבג $12.50','אבג 12,345.67','אבג +12 -34','אבג (012)','אבג 12/34','אבג 12 %','אבג £12','אבג ²','ABC\t012','אבג\t012','אבג ABC012','אבג 012ABC']]
cases += [dict(text=t,flag='both',parts=[t]) for t in ['012','אבג 012']]
cases += [dict(text=t,flag='rtl',parts=[t]) for t in ['אבג #12','אבג 12#','אבג %12','אבג 12:34','אבג 12+34','אבג €12','אבג ¥12','אבג ©12','ABC +012','ABC/012','ABC £012']]
body=[]
for i,c in enumerate(cases):
    c.update(index=i,page=i//7,label=f'Case {i+1}: {c["flag"]} '+('split' if len(c['parts'])>1 else 'joined'))
    br='<w:pageBreakBefore/>' if i and i%7==0 else ''
    body.append(f'<w:p><w:pPr>{br}<w:spacing w:before="0" w:after="120" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:t>{c["label"]}</w:t></w:r></w:p>')
    runs=[]
    for j,t in enumerate(c['parts']):
        color='<w:color w:val="0000FF"/>' if j else ''
        flag='<w:rtl/><w:cs/>' if c['flag']=='both' else f'<w:{c["flag"]}/>'
        props=f'<w:rFonts w:ascii="Arial" w:hAnsi="Times New Roman" w:cs="Courier New"/><w:sz w:val="20"/><w:szCs w:val="32"/><w:bCs/>{color}{flag}'
        text='<w:tab/>'.join(f'<w:t xml:space="preserve">{escape(segment)}</w:t>' for segment in t.split('\t'))
        runs.append(f'<w:r><w:rPr>{props}</w:rPr>{text}</w:r>')
    body.append('<w:p><w:pPr><w:spacing w:before="0" w:after="360" w:line="480" w:lineRule="exact"/></w:pPr><w:r><w:t xml:space="preserve">Left [ </w:t></w:r>'+''.join(runs)+'<w:r><w:t xml:space="preserve"> ] Right</w:t></w:r></w:p>')
body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>')
parts['word/document.xml']=f'<w:document xmlns:w="{w}"><w:body>{"".join(body)}</w:body></w:document>'.encode()
with ZipFile(root/'control.docx','w',ZIP_DEFLATED) as z:
    for n,data in parts.items():z.writestr(n,data)
(root/'cases.json').write_text(json.dumps(cases,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print(root/'control.docx')
