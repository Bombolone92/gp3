from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as E
import json
root=Path(__file__).resolve().parents[1]
work=root/'tests/fixtures/opentype-kerning'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
W14='http://schemas.microsoft.com/office/word/2010/wordml'
MC='http://schemas.openxmlformats.org/markup-compatibility/2006'
for prefix,uri in [('w',W),('w14',W14),('mc',MC)]:E.register_namespace(prefix,uri)
def node(p,tag,**attrs):return E.SubElement(p,'{'+W+'}'+tag,{'{'+W+'}'+k:str(v) for k,v in attrs.items()})
with ZipFile(root/'public/fixtures/opentype-kerning-0.docx') as z:base={n:z.read(n) for n in z.namelist()}
cases=[]
for enabled in [0,1]:
 parts=base.copy();doc=E.Element('{'+W+'}document',{'{'+MC+'}Ignorable':'w14'});body=node(doc,'body')
 cases=[]
 for family in ['Goudy Old Style','Garamond','Bell MT','Bodoni MT','Palatino Linotype','Constantia','Arial','Book Antiqua']:
  for ligature in ['none','standardContextual']:
   for text in ['0123456789','AVATAR To Wa','(423) 555-0124']:
    p=node(body,'p');pp=node(p,'pPr');node(pp,'spacing',before=0,after=0,line=280,lineRule='exact');node(pp,'jc',val='right')
    r=node(p,'r');rp=node(r,'rPr');node(rp,'rFonts',ascii=family,hAnsi=family);node(rp,'kern',val=2);node(rp,'sz',val=24)
    E.SubElement(rp,'{'+W14+'}ligatures',{'{'+W14+'}val':ligature});node(r,'t').text=text
    cases.append({'family':family,'ligatures':ligature,'text':text})
 sect=node(body,'sectPr');node(sect,'pgSz',w=12240,h=15840);node(sect,'pgMar',top=720,right=720,bottom=720,left=720,header=360,footer=360,gutter=0)
 settings=E.fromstring(parts['word/settings.xml'])
 for c in settings.iter('{'+W+'}compatSetting'):
  if c.get('{'+W+'}name')=='enableOpenTypeFeatures':c.set('{'+W+'}val',str(enabled))
 parts['word/settings.xml']=E.tostring(settings);parts['word/document.xml']=E.tostring(doc)
 with ZipFile(work/f'legacy-{enabled}.docx','w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)
(work/'legacy-cases.json').write_text(json.dumps(cases,indent=2)+'\n')
with ZipFile(work/'legacy-1.docx') as z:base={n:z.read(n) for n in z.namelist()}
for name,twips in [('positive',6),('negative',-6)]:
 parts=base.copy();doc=E.fromstring(parts['word/document.xml'])
 for rp in doc.findall('.//{'+W+'}rPr'):
  spacing=E.Element('{'+W+'}spacing',{'{'+W+'}val':str(twips)});rp.insert(1,spacing)
 parts['word/document.xml']=E.tostring(doc)
 with ZipFile(work/f'legacy-spacing-{name}.docx','w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)
