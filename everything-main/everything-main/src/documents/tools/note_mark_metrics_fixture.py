"""Original XML matrix separating note-mark and ordinary script line metrics."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root=Path(__file__).resolve().parents[1]
target=root/'tests/fixtures/note-mark-metrics'
target.mkdir(exist_ok=True)
with ZipFile(root/'tests/fixtures/inactive-note-marks/control.docx') as z:
    parts={n:z.read(n) for n in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
cases=[]; paragraphs=[]
for family in ['Arial','Times New Roman']:
    for align in ['baseline','superscript','subscript']:
        for kind in ['literal','footnoteRef','endnoteRef']:
            cases.append(dict(family=family,align=align,kind=kind))
for shift in [-10,10]:
    for kind in ['literal','footnoteRef','endnoteRef']:
        cases.append(dict(family='Arial',align='superscript',kind=kind,shift=shift))
for spacing in [240,360,192]:
    for kind in ['literal','footnoteRef','endnoteRef']:
        cases.append(dict(family='Arial',align='superscript',kind=kind,spacing=spacing))
for spacing in [360,192]:
    for kind in ['literal','footnoteRef','endnoteRef']:
        cases.append(dict(family='Arial',align='baseline',kind=kind,spacing=spacing,alone=True))
for markSize in [20,50]:
    for alone in [False,True]:
        cases.append(dict(family='Arial',align='baseline',kind='footnoteRef',spacing=360,alone=alone,markSize=markSize))
for index,c in enumerate(cases):
    name=f"Case {index+1}: {c['family']} {c['align']} {c['kind']} {c.get('shift',0)} spacing {c.get('spacing','default')}"
    c['name']=name
    paragraphs.append('<w:p><w:pPr>'+('<w:pageBreakBefore/>' if index else '')+'</w:pPr><w:r><w:t>'+name+'</w:t></w:r></w:p>')
    rp=f'<w:rFonts w:ascii="{c["family"]}" w:hAnsi="{c["family"]}"/><w:sz w:val="80"/><w:vertAlign w:val="{c["align"]}"/>'
    if c.get('shift'):rp+=f'<w:position w:val="{c["shift"]*2}"/>'
    content='<w:t>1</w:t>' if c['kind']=='literal' else f'<w:{c["kind"]}/>'
    pp=f'<w:pPr><w:spacing w:line="{c["spacing"]}" w:lineRule="auto"/></w:pPr>' if 'spacing' in c else ''
    if c.get('markSize'):pp=pp.replace('</w:pPr>',f'<w:rPr><w:sz w:val="{c["markSize"]*2}"/></w:rPr></w:pPr>')
    before='' if c.get('alone') else '<w:r><w:t>Before</w:t></w:r>'
    after='' if c.get('alone') else '<w:r><w:t>After</w:t></w:r>'
    paragraphs.append('<w:p>'+pp+before+'<w:r><w:rPr>'+rp+'</w:rPr>'+content+'</w:r>'+after+'</w:p>')
    paragraphs.append('<w:p><w:r><w:t>Following line</w:t></w:r></w:p>')
parts['word/document.xml']=(f'<w:document xmlns:w="{W}"><w:body>'+''.join(paragraphs)+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>').encode()
with ZipFile(target/'control.docx','w',ZIP_DEFLATED) as z:
    for n,b in parts.items():z.writestr(n,b)
(target/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
print(target/'control.docx')
