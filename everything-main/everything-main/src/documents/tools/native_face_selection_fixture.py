"""Original font-family versus exact-face selection controls."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
import json
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tests/fixtures/native-face-selection';OUT.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
def add(p,name,text=None,**attrs):
 n=E.SubElement(p,'{'+W+'}'+name)
 for k,v in attrs.items():n.set('{'+W+'}'+k,str(v))
 n.text=text;return n
with ZipFile(ROOT/'public/fixtures/shape-theme.docx') as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);b=r.find('{'+W+'}body');sect=b.find('{'+W+'}sectPr');b.remove(sect);b.clear();rows=[]
for family in ['Franklin Gothic Medium','Franklin Gothic Demi','Arial','Times New Roman']:
 for bold,italic in [(False,False),(True,False),(False,True),(True,True)]:
  p=add(b,'p');pr=add(p,'pPr');add(pr,'spacing',before=0,after=0,line=600,lineRule='exact');run=add(p,'r');rp=add(run,'rPr');add(rp,'rFonts',ascii=family,hAnsi=family,eastAsia=family,cs=family);add(rp,'b',val=int(bold));add(rp,'i',val=int(italic));add(rp,'color',val='000000');add(rp,'sz',val=36);add(rp,'kern',val=0)
  text='Hamburgefontsiv MW0123';add(run,'t',text=text);rows.append(dict(family=family,bold=bold,italic=italic,text=text))
b.append(sect);parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
 for n,data in parts.items():z.writestr(n,data)
(OUT/'cases.json').write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8')
