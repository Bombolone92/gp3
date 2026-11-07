"""Independent neutral-luminance controls isolate effect-entry alpha rounding."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import json
from copy import deepcopy
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/picture-luminance-neutral'; OUT.mkdir(exist_ok=True)
A='http://schemas.openxmlformats.org/drawingml/2006/main'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
def lum(bright=0,contrast=0):return f'<a:lum bright="{bright}" contrast="{contrast}"/>'
cases=[('Original',''),('Neutral',lum()),('Neutral twice',lum()+lum()),('Neutral three times',lum()*3),('Brightness 1',lum(1)),('Brightness -1',lum(-1)),('Brightness 100',lum(100)),('Brightness -100',lum(-100)),('Brightness 25000',lum(25000))]
with ZipFile(ROOT/'public/fixtures/picture-duotone.docx') as z:parts={n:z.read(n) for n in z.namelist()}
root=E.fromstring(parts['word/document.xml']);body=root.find('{'+W+'}body')
picture=deepcopy(next(p for p in body if p.find('.//{'+A+'}blip') is not None))
section=deepcopy(body.find('{'+W+'}sectPr'));body.clear()
for text in ['Picture luminance controls']:
 p=E.SubElement(body,'{'+W+'}p');r=E.SubElement(p,'{'+W+'}r');E.SubElement(r,'{'+W+'}t').text=text
for i,(label,_) in enumerate(cases):
 p=E.SubElement(body,'{'+W+'}p');r=E.SubElement(p,'{'+W+'}r');E.SubElement(r,'{'+W+'}t').text=f'L{i:02} {label}'
 copy=deepcopy(picture)
 for n in copy.iter():
  if E.QName(n).localname in ['docPr','cNvPr']:n.set('id',str(i+1));n.set('name',f'L{i:02}')
 body.append(copy)
body.append(section)
blips=root.findall('.//{'+A+'}blip')
for blip,(label,effect) in zip(blips,cases):
 for node in list(blip):blip.remove(node)
 wrapper=E.fromstring(f'<a:root xmlns:a="{A}">{effect}</a:root>')
 for node in list(wrapper):blip.append(node)
texts=root.findall('.//{'+W+'}t');texts[0].text='Picture luminance controls'
for i,((label,effect),text) in enumerate(zip(cases,texts[1:])):text.text=f'L{i:02} {label}'
parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(name,data)
colors=json.loads((ROOT/'tests/fixtures/picture-duotone/cases.json').read_text())['colors']
(OUT/'cases.json').write_text(json.dumps(dict(colors=colors,cases=[dict(id=f'L{i:02}',label=label,effect=effect) for i,(label,effect) in enumerate(cases)]),indent=2)+'\n')
