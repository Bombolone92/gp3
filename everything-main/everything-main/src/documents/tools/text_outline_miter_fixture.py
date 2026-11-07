"""Original text-outline miter limit controls."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
import json
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tests/fixtures/text-outline-miters';OUT.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';W14='http://schemas.microsoft.com/office/word/2010/wordml'
with ZipFile(ROOT/'public/fixtures/text-outline-control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);b=r.find('{'+W+'}body');sect=b.find('{'+W+'}sectPr');b.remove(sect);b.clear()
def add(parent,ns,name,**attrs):return E.SubElement(parent,'{'+ns+'}'+name,{'{'+ns+'}'+k:str(v) for k,v in attrs.items()})
cases=[]
for i,limit in enumerate([0,50000,100000,200000,400000,800000,None,'bevel']):
 p=add(b,W,'p');pr=add(p,W,'pPr');add(pr,W,'spacing',after=0,line=1560,lineRule='exact');run=add(p,W,'r');rp=add(run,W,'rPr');add(rp,W,'rFonts',ascii='Arial',hAnsi='Arial');add(rp,W,'sz',val=96)
 o=add(rp,W14,'textOutline',w=38100,cap='sq',cmpd='sng',algn='ctr');color=add(add(o,W14,'solidFill'),W14,'srgbClr',val='9040B0')
 add(o,W14,'bevel' if limit=='bevel' else 'miter',**({} if limit is None or limit=='bevel' else {'lim':limit}))
 add(add(rp,W14,'textFill'),W14,'noFill');add(run,W,'t').text='MWAV';cases.append(dict(limit=limit))
b.append(sect);parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
 for n,data in parts.items():z.writestr(n,data)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
