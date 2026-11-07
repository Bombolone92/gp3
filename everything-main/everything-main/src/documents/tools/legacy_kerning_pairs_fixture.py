"""Original pair/space controls separating legacy and OpenType positioning."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from xml.etree import ElementTree as E
import json
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/legacy-kerning-pairs';folder.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
W14='http://schemas.microsoft.com/office/word/2010/wordml';MC='http://schemas.openxmlformats.org/markup-compatibility/2006'
for prefix,uri in [('w',W),('w14',W14),('mc',MC)]:E.register_namespace(prefix,uri)
def node(p,tag,**attrs):return E.SubElement(p,'{'+W+'}'+tag,{'{'+W+'}'+k:str(v) for k,v in attrs.items()})
with ZipFile(root/'public/fixtures/opentype-kerning-0.docx') as z:base={n:z.read(n) for n in z.namelist()}
cases=[]
for enabled,spacing in [(0,0),(1,0),(0,6),(0,-6)]:
 parts=base.copy();doc=E.Element('{'+W+'}document',{'{'+MC+'}Ignorable':'w14'});body=node(doc,'body');cases=[]
 for fi,family in enumerate(['Palatino Linotype','Constantia','Arial','Goudy Old Style']):
  for ti,text in enumerate(['AV','VA','AT','TA','To','Wa','Rx','R x','oT','o T','aW','a W','AVATARToWa','AVATAR To Wa']):
   p=node(body,'p');pp=node(p,'pPr')
   if fi==2 and ti==0:node(pp,'pageBreakBefore')
   node(pp,'spacing',before=0,after=0,line=280,lineRule='exact');node(pp,'jc',val='right')
   r=node(p,'r');rp=node(r,'rPr');node(rp,'rFonts',ascii=family,hAnsi=family)
   if spacing:node(rp,'spacing',val=spacing)
   node(rp,'kern',val=2);node(rp,'sz',val=24)
   E.SubElement(rp,'{'+W14+'}ligatures',{'{'+W14+'}val':'none'});node(r,'t').text=text
   cases.append(dict(family=family,text=text,page=fi//2))
 sect=node(body,'sectPr');node(sect,'pgSz',w=12240,h=15840);node(sect,'pgMar',top=720,right=720,bottom=720,left=720,header=360,footer=360,gutter=0)
 settings=E.fromstring(parts['word/settings.xml'])
 for c in settings.iter('{'+W+'}compatSetting'):
  if c.get('{'+W+'}name')=='enableOpenTypeFeatures':c.set('{'+W+'}val',str(enabled))
 parts['word/settings.xml']=E.tostring(settings);parts['word/document.xml']=E.tostring(doc)
 suffix=f'{enabled}'+('-positive' if spacing>0 else '-negative' if spacing<0 else '')
 with ZipFile(folder/f'control-{suffix}.docx','w') as z:
  for n,b in parts.items():
   info=ZipInfo(n,(2026,9,25,5,20,54));info.create_system=0;info.external_attr=0o600<<16;z.writestr(info,b,compress_type=ZIP_DEFLATED)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf8')
