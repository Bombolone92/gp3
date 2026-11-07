# Original repeated/reordered glyph controls for rotated baseline positions.
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
repo=Path(__file__).resolve().parents[1]
target=repo/'tests/fixtures/cell-text-direction/origins.docx'
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
with ZipFile(repo/'tests/fixtures/cell-text-direction/height.docx') as z:
    parts={name:z.read(name) for name in z.namelist()}
root=E.fromstring(parts['word/document.xml'])
body=root.find(W+'body'); section=deepcopy(body[-1]); template=deepcopy(body.findall(W+'tbl')[5]); body.clear()
cases=[('a', ['a']*6),('Al',['Al']*6),('ph',['ph']*6),('ta',['ta']*6),('forward',['Al','ph','a','be','ta','a']),('reverse',['a','ta','be','a','ph','Al'])]
for i,(label,lines) in enumerate(cases):
    p=E.SubElement(body,W+'p'); pr=E.SubElement(p,W+'pPr')
    if i: E.SubElement(pr,W+'pageBreakBefore')
    E.SubElement(E.SubElement(p,W+'r'),W+'t').text=label
    table=deepcopy(template); row=table.find(W+'tr')
    rp=row.find(W+'trPr')
    if rp is None: rp=E.Element(W+'trPr'); row.insert(0,rp)
    for old in rp.findall(W+'trHeight'): rp.remove(old)
    E.SubElement(rp,W+'trHeight',{W+'val':'1200',W+'hRule':'exact'})
    for cell in row.findall(W+'tc'):
        run=cell.find(W+'p').find(W+'r')
        for old in list(run):
            if old.tag!=W+'rPr': run.remove(old)
        for j,text in enumerate(lines):
            if j: E.SubElement(run,W+'br')
            E.SubElement(run,W+'t').text=text
    body.append(table)
body.append(section)
parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(target,'w',ZIP_DEFLATED) as z:
    for name,data in parts.items(): z.writestr(name,data)
print(target)
