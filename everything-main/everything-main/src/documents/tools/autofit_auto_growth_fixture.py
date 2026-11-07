"""Original AutoFit controls for automatic growth, width limits and alignment."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'tests/fixtures/autofit-auto-growth'
SOURCE=ROOT/'tests/fixtures/autofit-span-pressure/legacy.docx'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
ns={'w':W}

def build(name,page_width,modern=False):
    source=SOURCE
    with ZipFile(source) as z: parts={n:z.read(n) for n in z.namelist()}
    root=E.fromstring(parts['word/document.xml']); body=root.find('w:body',ns)
    template=deepcopy(body.findall('w:tbl',ns)[2]); section=deepcopy(body.find('w:sectPr',ns));body.clear()
    cases=[('auto',False,80,80,None),('auto',True,80,80,None),('dxa',False,80,80,None),('dxa',True,80,80,None),('pct',False,80,80,None),('pct',True,80,80,None),('auto',False,160,120,None),('auto',True,160,120,None),('auto',False,80,80,'center'),('auto',False,80,80,'right')]
    for i,(kind,indent,left,right,align) in enumerate(cases):
        p=E.SubElement(body,f'{{{W}}}p');pr=E.SubElement(p,f'{{{W}}}pPr')
        if i:E.SubElement(pr,f'{{{W}}}pageBreakBefore')
        r=E.SubElement(p,f'{{{W}}}r');E.SubElement(r,f'{{{W}}}t').text=f'Case {i+1}: {kind}, indent={indent}, margins={left}/{right}, align={align}'
        table=deepcopy(template);pr=table.find('w:tblPr',ns)
        width=pr.find('w:tblW',ns);width.set(f'{{{W}}}type',kind);width.set(f'{{{W}}}w','0' if kind=='auto' else '5000' if kind=='pct' else '6000')
        at=1
        if align:
            el=E.Element(f'{{{W}}}jc');el.set(f'{{{W}}}val',align);pr.insert(at,el);at+=1
        if indent:
            el=E.Element(f'{{{W}}}tblInd');el.set(f'{{{W}}}w','0');el.set(f'{{{W}}}type','dxa');pr.insert(at,el)
        for side,value in [('left',left),('right',right)]:pr.find('w:tblCellMar/w:'+side,ns).set(f'{{{W}}}w',str(value))
        body.append(table)
    section.find('w:pgSz',ns).set(f'{{{W}}}w',str(page_width));E.SubElement(body,f'{{{W}}}p');body.append(section);parts['word/document.xml']=E.tostring(root)
    if modern:
        with ZipFile(SOURCE.parent/'modern.docx') as z:
            for n in ['word/settings.xml','word/_rels/document.xml.rels','[Content_Types].xml']:parts[n]=z.read(n)
    with ZipFile(FOLDER/(name+'.docx'),'w',ZIP_DEFLATED) as z:
        for n,b in parts.items():z.writestr(n,b)

if __name__=='__main__':
    FOLDER.mkdir(exist_ok=True)
    build('legacy-limit',7440)
    build('legacy-wide',9440)
    build('modern-wide',9440,True)
