"""Original W14 outline luminance controls; no corpus content."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import json
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tests/fixtures/text-outline-luminance';OUT.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';W14='http://schemas.microsoft.com/office/word/2010/wordml'
with ZipFile(ROOT/'tests/fixtures/text-outline-miters/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
with ZipFile(ROOT/'public/fixtures/text-colors.docx') as z:
 theme=next(n for n in z.namelist() if n.startswith('word/theme/') and n.endswith('.xml'));parts['word/theme/theme1.xml']=z.read(theme)
rels=E.fromstring(parts['word/_rels/document.xml.rels']);R='http://schemas.openxmlformats.org/package/2006/relationships'
E.SubElement(rels,'{'+R+'}Relationship',Id='luminanceTheme',Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',Target='theme/theme1.xml')
parts['word/_rels/document.xml.rels']=E.tostring(rels)
ct=E.fromstring(parts['[Content_Types].xml']);E.SubElement(ct,'{http://schemas.openxmlformats.org/package/2006/content-types}Override',PartName='/word/theme/theme1.xml',ContentType='application/vnd.openxmlformats-officedocument.theme+xml');parts['[Content_Types].xml']=E.tostring(ct)
r=E.fromstring(parts['word/document.xml']);b=r.find('{'+W+'}body');sect=b.find('{'+W+'}sectPr');b.remove(sect);b.clear()
def add(parent,ns,name,**attrs):return E.SubElement(parent,'{'+ns+'}'+name,{'{'+ns+'}'+k:str(v) for k,v in attrs.items()})
cases=[]
for kind,color,transforms in [
 ('srgbClr','9040B0',[]),('srgbClr','9040B0',[('lumMod',75000)]),
 ('srgbClr','9040B0',[('lumMod',0)]),('srgbClr','9040B0',[('lumMod',200000)]),
 ('srgbClr','9040B0',[('lumOff',20000)]),('srgbClr','9040B0',[('lumOff',-20000)]),
 ('srgbClr','9040B0',[('lumMod',50000),('lumOff',20000)]),
 ('srgbClr','9040B0',[('lumOff',20000),('lumMod',50000)]),
 ('schemeClr','accent1',[('lumMod',75000)]),('schemeClr','accent6',[('lumMod',75000)]),
 ('srgbClr','FFFFFF',[('lumMod',50000)]),('srgbClr','112233',[('lumMod',25000)]),
 ('srgbClr','9040B0',[('lumMod',-10000)]),('srgbClr','000000',[('lumOff',40000)]),
 ('srgbClr','9040B0',[('lumOff',-200000)]),('srgbClr','9040B0',[('lumOff',200000)])]:
 p=add(b,W,'p');pr=add(p,W,'pPr');add(pr,W,'spacing',after=0,line=720,lineRule='exact');run=add(p,W,'r');rp=add(run,W,'rPr');add(rp,W,'rFonts',ascii='Arial',hAnsi='Arial');add(rp,W,'sz',val=48)
 o=add(rp,W14,'textOutline',w=25400,cap='sq',cmpd='sng',algn='ctr');c=add(add(o,W14,'solidFill'),W14,kind,val=color)
 for name,value in transforms:add(c,W14,name,val=value)
 add(o,W14,'bevel');add(add(rp,W14,'textFill'),W14,'noFill');add(run,W,'t').text='MWAV'
 cases.append(dict(kind=kind,color=color,transforms=transforms))
b.append(sect);parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
 for n,data in parts.items():z.writestr(n,data)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
