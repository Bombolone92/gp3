"""Original Calibri ligature controls; no corpus text or artwork."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import json
root=Path(__file__).resolve().parents[1]
out=root/'tests/fixtures/latin-ligature-defaults';out.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'; W14='http://schemas.microsoft.com/office/word/2010/wordml';MC='http://schemas.openxmlformats.org/markup-compatibility/2006'
def n(p,t,**a):return E.SubElement(p,'{'+W+'}'+t,{'{'+W+'}'+k:str(v) for k,v in a.items()})
with ZipFile(root/'public/fixtures/opentype-kerning-1.docx') as z:base={k:z.read(k) for k in z.namelist()}
for enabled in [0,1]:
 parts=base.copy();doc=E.Element('{'+W+'}document',nsmap={'w':W,'w14':W14,'mc':MC});doc.set('{'+MC+'}Ignorable','w14');body=n(doc,'body');cases=[]
 for mode in ['omitted','none','standard','standardContextual']:
  for text in ['ti ti ti ti ti ti ti ti','office affinity efficient','administrative initiative']:
   p=n(body,'p');pp=n(p,'pPr');n(pp,'spacing',after=160);n(pp,'jc',val='right');r=n(p,'r');rp=n(r,'rPr');n(rp,'rFonts',ascii='Calibri',hAnsi='Calibri');n(rp,'kern',val=0);n(rp,'sz',val=40)
   if mode!='omitted':E.SubElement(rp,'{'+W14+'}ligatures',{'{'+W14+'}val':mode})
   n(r,'t').text=text;cases.append({'mode':mode,'text':text})
 sect=n(body,'sectPr');n(sect,'pgSz',w=12240,h=15840);n(sect,'pgMar',top=720,right=720,bottom=720,left=720,header=360,footer=360,gutter=0)
 settings=E.fromstring(parts['word/settings.xml'])
 for el in settings.iter('{'+W+'}compatSetting'):
  if el.get('{'+W+'}name')=='enableOpenTypeFeatures':el.set('{'+W+'}val',str(enabled))
 parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True);parts['word/settings.xml']=E.tostring(settings)
 with ZipFile(out/f'control-{enabled}.docx','w',ZIP_DEFLATED) as z:
  for k,v in parts.items():z.writestr(k,v)
(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
