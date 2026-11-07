"""Independent controls for main/companion style resolution, using original fixture art."""
from pathlib import Path
from copy import deepcopy
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/styles-with-effects';folder.mkdir(exist_ok=True)
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
with ZipFile(root/'tests/fixtures/cell-text-direction/links.docx') as z:
    parts={name:z.read(name) for name in z.namelist()}
main=E.fromstring(parts['word/styles.xml'])
effects=E.Element(W+'styles',nsmap={'w':W[1:-1]})
def style(parent,id,kind='table',indent=None,based=None,default=False,size=None,color=None):
    node=E.SubElement(parent,W+'style',{W+'type':kind,W+'customStyle':'1',W+'styleId':id})
    if default:node.set(W+'default','1')
    E.SubElement(node,W+'name',{W+'val':id})
    if based:E.SubElement(node,W+'basedOn',{W+'val':based})
    if size or color:
        rp=E.SubElement(node,W+'rPr')
        if color:E.SubElement(rp,W+'color',{W+'val':color})
        if size:E.SubElement(rp,W+'sz',{W+'val':str(size)})
    if indent is not None:
        pr=E.SubElement(node,W+'tblPr');E.SubElement(pr,W+'tblInd',{W+'w':str(indent),W+'type':'dxa'})
    return node
style(effects,'EffectsOnly',indent=360,default=True)
style(main,'Conflict',indent=720);style(effects,'Conflict',indent=360)
style(main,'EmptyPrimary');style(effects,'EmptyPrimary',indent=360)
style(main,'PrimaryDerived',based='EffectsOnly')
style(effects,'EffectsDerived',based='Conflict')
style(effects,'EffectsParagraph',kind='paragraph',size=40,color='FF0000')
style(main,'ConflictParagraph',kind='paragraph',size=24,color='0000FF')
style(effects,'ConflictParagraph',kind='paragraph',size=40,color='FF0000')
style(effects,'EffectsCharacter',kind='character',size=40,color='FF0000')
doc=E.fromstring(parts['word/document.xml']);body=doc.find(W+'body');section=deepcopy(body.find(W+'sectPr'));base=deepcopy(body.find(W+'tbl'))
for n in base.findall('.//'+W+'textDirection'):n.getparent().remove(n)
for n in base.findall('.//'+W+'trHeight'):n.set(W+'val','800');n.set(W+'hRule','atLeast')
for cell in base.findall('.//'+W+'tc'):
    paragraphs=cell.findall(W+'p')
    for p in paragraphs[:-1]:cell.remove(p)
for n in list(body):body.remove(n)
for id in ['EffectsParagraph','ConflictParagraph','EffectsCharacter']:
    p=E.SubElement(body,W+'p');pr=E.SubElement(p,W+'pPr')
    if id!='EffectsCharacter':E.SubElement(pr,W+'pStyle',{W+'val':id})
    E.SubElement(pr,W+'spacing',{W+'line':'480',W+'lineRule':'exact'})
    r=E.SubElement(p,W+'r')
    if id=='EffectsCharacter':rp=E.SubElement(r,W+'rPr');E.SubElement(rp,W+'rStyle',{W+'val':id})
    E.SubElement(r,W+'t').text=id
for index,id in enumerate(['EffectsOnly','Conflict','EmptyPrimary','PrimaryDerived','EffectsDerived',None]):
    p=E.SubElement(body,W+'p');E.SubElement(E.SubElement(p,W+'r'),W+'t').text=id or 'Default companion table'
    table=deepcopy(base);pr=table.find(W+'tblPr')
    if id:pr.insert(0,E.Element(W+'tblStyle',{W+'val':id}))
    for j,n in enumerate(table.findall('.//{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}docPr')):n.set('id',str(index*3+j+1))
    body.append(table)
E.SubElement(body,W+'p');body.append(section)
parts['word/document.xml']=E.tostring(doc);parts['word/styles.xml']=E.tostring(main);parts['word/stylesWithEffects.xml']=E.tostring(effects)
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items():z.writestr(name,data)

# A separate text-bearing control checks the companion table's run formatting
# without changing the picture-origin reference above.
table_style=next(s for s in effects.findall(W+'style') if s.get(W+'styleId')=='EffectsOnly')
rp=E.Element(W+'rPr');E.SubElement(rp,W+'b');E.SubElement(rp,W+'color',{W+'val':'008000'})
table_style.insert(1,rp)
for cell in doc.findall('.//'+W+'tc'):
    p=cell.find(W+'p');run=E.Element(W+'r');t=E.SubElement(run,W+'t');t.set('{http://www.w3.org/XML/1998/namespace}space','preserve');t.text='Probe '
    p.insert(1,run)
parts['word/document.xml']=E.tostring(doc);parts['word/stylesWithEffects.xml']=E.tostring(effects)
with ZipFile(folder/'runs.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items():z.writestr(name,data)
