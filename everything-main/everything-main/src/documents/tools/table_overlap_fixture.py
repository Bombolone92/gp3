"""Original floating-table collision controls; reuse only our own Arial boilerplate."""
from pathlib import Path
from copy import deepcopy
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import json
from page_vertical_alignment_fixture import node, paragraph, section, W, FOLDER

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/table-overlap'

def build(name, cases):
    with ZipFile(FOLDER/'floating.docx') as z:
        parts = {n:z.read(n) for n in z.namelist()}
    doc=E.fromstring(parts['word/document.xml'])
    template=doc.find('.//{'+W+'}tbl');body=doc.find('{'+W+'}body');body.clear()
    for case in cases:
        for number,overlap in enumerate([case['first'],case['second']]):
            table=deepcopy(template);pr=table.find('{'+W+'}tblPr');pos=pr.find('{'+W+'}tblpPr')
            pos.set('{'+W+'}vertAnchor',case['anchor'])
            pos.set('{'+W+'}tblpY','2000' if case['anchor']=='page' else '400')
            pos.set('{'+W+'}tblpX',str(number*800) if name=='probe' else '0')
            if name=='width':
                pos.set('{'+W+'}leftFromText',str(case['gap']));pos.set('{'+W+'}rightFromText',str(case['gap']))
            elif name=='gap':
                pos.set('{'+W+'}leftFromText',str(case['gap2'] if number else 0))
                pos.set('{'+W+'}rightFromText',str(0 if number else case['gap1']))
            if overlap:pr.insert(1,node('tblOverlap',val=overlap))
            width=case.get('width',2400)
            pr.find('{'+W+'}tblW').set('{'+W+'}w',str(width))
            table.find('.//{'+W+'}gridCol').set('{'+W+'}w',str(width))
            for c in table.findall('.//{'+W+'}tcW'):c.set('{'+W+'}w',str(width))
            for i,t in enumerate(table.findall('.//{'+W+'}t')):t.text=f'{"A" if number==0 else "B"} row {i+1}'
            body.append(table);body.append(paragraph('Anchor '+str(number+1)))
        body[-1].find('{'+W+'}pPr').append(section('top'))
    last=body[-1].find('{'+W+'}pPr');last.remove(last.find('{'+W+'}sectPr'));body.append(section('top'))
    parts['word/document.xml']=E.tostring(doc)
    OUT.mkdir(exist_ok=True,parents=True)
    with ZipFile(OUT/(name+'.docx'),'w',ZIP_DEFLATED) as z:
        for n,b in parts.items():z.writestr(n,b)
    (OUT/(name+'-cases.json')).write_text(json.dumps(cases,indent=2)+'\n')

if __name__=='__main__':
    build('probe',[dict(anchor=a,first=f,second=s) for a in ['page','margin','text']
        for f,s in [(None,None),('overlap','overlap'),('never',None),(None,'never'),('never','never')]])
    build('width',[dict(anchor='margin',first='never',second=None,width=w,gap=g)
        for g in [0,180,720] for w in [2400,4000,5000,8000]])
    build('gap',[dict(anchor='margin',first='never',second=None,width=2400,gap1=r,gap2=l)
        for r,l in [(0,0),(0,1),(0,10),(0,12),(0,24),(0,180),(1,0),(10,0),(12,0),(24,0),(180,0)]])
