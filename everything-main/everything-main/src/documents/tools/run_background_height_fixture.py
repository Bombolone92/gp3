"""Independent line-spacing and run-background geometry controls."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
repo=Path(__file__).resolve().parents[1]
root=repo/'tests/fixtures/run-background-height';root.mkdir(exist_ok=True)
with ZipFile(repo/'tests/fixtures/bidi-layout/control.docx') as z: parts={n:z.read(n) for n in z.namelist()}
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
cases=[];body=[]
for rtl in [False,True]:
 for kind in ['highlight','shading']:
  for rule,value in [('auto',240),('auto',480),('exact',720),('exact',240),('atLeast',720),('atLeast',240)]:
   cases.append(dict(rtl=rtl,kind=kind,rule=rule,value=value,size=20,mixed=False))
for rule,value in [('auto',240),('auto',480),('exact',720),('atLeast',720)]:
 cases.append(dict(rtl=False,kind='highlight',rule=rule,value=value,size=10,mixed=True))
for i,case in enumerate(cases):
 case['index']=i
 page='<w:pageBreakBefore/>' if i and i%6==0 else ''
 body.append(f'<w:p><w:pPr>{page}<w:spacing w:before="0" w:after="0" w:line="300" w:lineRule="exact"/></w:pPr><w:r><w:t>Case {i+1}</w:t></w:r></w:p>')
 bg='<w:highlight w:val="yellow"/>' if case['kind']=='highlight' else '<w:shd w:val="clear" w:fill="FFFF00"/>'
 props=f'<w:sz w:val="{case["size"]*2}"/><w:szCs w:val="{case["size"]*2}"/>'+('<w:rtl/>' if case['rtl'] else '')+bg
 text='אבגד' if case['rtl'] else 'ABCD'
 extra='<w:r><w:rPr><w:sz w:val="60"/></w:rPr><w:t>Large</w:t></w:r>' if case['mixed'] else ''
 body.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="240" w:line="{case["value"]}" w:lineRule="{case["rule"]}"/></w:pPr><w:r><w:rPr>{props}</w:rPr><w:t>{text}</w:t></w:r>{extra}</w:p>')
body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>')
parts['word/document.xml']=f'<w:document xmlns:w="{w}"><w:body>{"".join(body)}</w:body></w:document>'.encode()
with ZipFile(root/'control.docx','w',ZIP_DEFLATED) as z:
 for n,data in parts.items():z.writestr(n,data)
(root/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
