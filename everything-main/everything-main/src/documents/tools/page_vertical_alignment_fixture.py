"""Original section-alignment controls; no corpus content or artwork."""
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
import json
from lxml import etree as E
from docx import Document

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'tests/fixtures/page-vertical-alignment'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
def node(tag, **attrs):
    return E.Element('{'+W+'}'+tag, {'{'+W+'}'+k: str(v) for k,v in attrs.items()})
def paragraph(text, before=0, after=0):
    p=node('p'); prop=node('pPr'); prop.append(node('spacing',before=before,after=after,line=360,lineRule='exact'));p.append(prop)
    for i,part in enumerate(text.split('\n')):
        r=node('r')
        if i:r.append(node('br'))
        t=node('t');t.text=part;r.append(t);p.append(r)
    return p
def section(align):
    s=node('sectPr');s.append(node('type',val='nextPage'));s.append(node('pgSz',w=12240,h=15840))
    s.append(node('pgMar',top=1440,right=1440,bottom=1440,left=1440,header=720,footer=720,gutter=0))
    s.append(node('vAlign',val=align));return s

def build():
    d=Document();d.settings.element.find('{'+W+'}zoom').set('{'+W+'}percent','100')
    normal=d.styles['Normal'];normal.font.name='Arial'
    from docx.shared import Pt
    normal.font.size=Pt(12)
    stream=BytesIO();d.save(stream)
    with ZipFile(stream) as z:parts={n:z.read(n) for n in z.namelist()}
    doc=E.Element('{'+W+'}document',nsmap={'w':W});body=node('body');doc.append(body);cases=[]
    for align in ['top','center','bottom','both']:
        for kind in ['one','paragraphs','soft','spaced','table','break']:
            case={'alignment':align,'kind':kind,'pages':2 if kind=='break' else 1};cases.append(case)
            if kind=='one':blocks=[paragraph('Alpha')]
            elif kind=='paragraphs':blocks=[paragraph(t) for t in ['Alpha','Beta','Gamma']]
            elif kind=='soft':blocks=[paragraph('Alpha\nBeta\nGamma')]
            elif kind=='spaced':blocks=[paragraph('Alpha',240,480),paragraph('Beta',120,480),paragraph('Gamma',0,480)]
            elif kind=='table':
                table=node('tbl');pr=node('tblPr');pr.append(node('tblW',w=4000,type='dxa'));pr.append(node('tblLayout',type='fixed'));table.append(pr)
                grid=node('tblGrid');grid.append(node('gridCol',w=4000));table.append(grid)
                for text in ['Cell one','Cell two','Cell three']:
                    row=node('tr');rp=node('trPr');rp.append(node('trHeight',val=720,hRule='exact'));row.append(rp)
                    cell=node('tc');cp=node('tcPr');cp.append(node('tcW',w=4000,type='dxa'));cell.append(cp);cell.append(paragraph(text));row.append(cell);table.append(row)
                blocks=[paragraph('Before'),table,paragraph('After')]
            else:
                p=paragraph('Alpha');r=node('r');r.append(node('br',type='page'));p.append(r);blocks=[p,paragraph('Beta')]
            for p in blocks:body.append(p)
            blocks[-1].find('{'+W+'}pPr').append(section(align))
    cases.append(dict(alignment='both',kind='document-end',pages=1))
    for text in ['Final Alpha','Final Beta','Final Gamma']:body.append(paragraph(text))
    body.append(section('both'))
    parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
    settings=E.fromstring(parts['word/settings.xml'])
    for c in settings.iter('{'+W+'}compatSetting'):
        if c.get('{'+W+'}name')=='compatibilityMode':c.set('{'+W+'}val','15')
    parts['word/settings.xml']=E.tostring(settings,xml_declaration=True,encoding='UTF-8',standalone=True)
    FOLDER.mkdir(parents=True,exist_ok=True)
    with ZipFile(FOLDER/'control.docx','w',ZIP_DEFLATED) as z:
        for n,b in parts.items():z.writestr(n,b)
    (FOLDER/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')

def build_floating():
    with ZipFile(FOLDER/'control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
    doc=E.fromstring(parts['word/document.xml']);template=doc.find('.//{'+W+'}tbl');body=doc.find('{'+W+'}body');body.clear();cases=[]
    for align in ['top','center','bottom','both']:
        for position in ['text','page']:
            table=deepcopy(template);pr=table.find('{'+W+'}tblPr')
            pr.insert(0,node('tblpPr',horzAnchor='margin',vertAnchor=position,tblpX=0,tblpY=1))
            pr.find('{'+W+'}tblW').set('{'+W+'}w','9360');table.find('.//{'+W+'}gridCol').set('{'+W+'}w','9360')
            for c in table.findall('.//{'+W+'}tcW'):c.set('{'+W+'}w','9360')
            body.append(paragraph('Before'));body.append(table);last=paragraph('After');body.append(last)
            if align=='both' and position=='page':body.append(section(align))
            else:last.find('{'+W+'}pPr').append(section(align))
            cases.append(dict(alignment=align,position=position,pages=1))
    parts['word/document.xml']=E.tostring(doc)
    with ZipFile(FOLDER/'floating.docx','w',ZIP_DEFLATED) as z:
        for n,b in parts.items():z.writestr(n,b)
    (FOLDER/'floating-cases.json').write_text(json.dumps(cases,indent=2)+'\n')

if __name__=='__main__':
    build()
    build_floating()
