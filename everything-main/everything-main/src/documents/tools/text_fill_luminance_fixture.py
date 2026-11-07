"""Original W14 fill controls, composed from our original OPC/theme fixtures."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import json

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/text-fill-luminance'
OUT.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
W14='http://schemas.microsoft.com/office/word/2010/wordml'
with ZipFile(ROOT/'tests/fixtures/text-outline-luminance/control.docx') as z:
 parts={n:z.read(n) for n in z.namelist()}
cases=json.loads((ROOT/'tests/fixtures/text-outline-luminance/cases.json').read_text())
cases += [
 dict(kind='srgbClr',color='9040B0',transforms=[['lumMod',75000],['lumMod',75000]]),
 dict(kind='srgbClr',color='9040B0',transforms=[['lumOff',10000],['lumOff',10000]]),
 dict(kind='schemeClr',color='accent4',transforms=[['lumMod',75000],['lumMod',75000]],scope='paragraph'),
 dict(kind='schemeClr',color='accent4',transforms=[['lumOff',20000],['lumMod',50000]],scope='character'),
]
root=E.fromstring(parts['word/document.xml']);body=root.find('{'+W+'}body')
sect=body.find('{'+W+'}sectPr');body.remove(sect);body.clear()
styles=E.fromstring(parts['word/styles.xml'])
def add(parent,ns,name,**attrs):
 return E.SubElement(parent,'{'+ns+'}'+name,{'{'+ns+'}'+k:str(v) for k,v in attrs.items()})
for i,c in enumerate(cases):
 p=add(body,W,'p');pp=add(p,W,'pPr');add(pp,W,'spacing',after=0,line=560,lineRule='exact')
 run=add(p,W,'r');rp=add(run,W,'rPr');add(rp,W,'rFonts',ascii='Arial',hAnsi='Arial');add(rp,W,'sz',val=40)
 target=rp
 if c.get('scope'):
  sid='Luminance'+str(i);style=add(styles,W,'style',type=c['scope'],styleId=sid)
  add(style,W,'name',val=sid);target=add(style,W,'rPr')
  owner=pp if c['scope']=='paragraph' else rp
  reference=add(owner,W,'pStyle' if c['scope']=='paragraph' else 'rStyle',val=sid)
  owner.remove(reference);owner.insert(0,reference)
 color=add(add(add(target,W14,'textFill'),W14,'solidFill'),W14,c['kind'],val=c['color'])
 for name,value in c['transforms']:add(color,W14,name,val=value)
 add(run,W,'t').text=f'MWAV {i+1:02}'
body.append(sect)
for name,node in [('word/document.xml',root),('word/styles.xml',styles)]:
 parts[name]=E.tostring(node,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
 for name,value in parts.items():z.writestr(name,value)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
print(OUT/'control.docx')
