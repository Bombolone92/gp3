"""Independent paired main-story/WPS text-fill opacity controls."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
from canvas_group_fixture import tag, add
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/text-fill-alpha';OUT.mkdir(exist_ok=True)
W14='http://schemas.microsoft.com/office/word/2010/wordml'
def effect(parent,name,**attrs):
 return E.SubElement(parent,'{'+W14+'}'+name,{'{'+W14+'}'+k:str(v) for k,v in attrs.items()})
with ZipFile(ROOT/'tests/fixtures/shape-tables/source.docx') as z:parts={n:z.read(n) for n in z.namelist()}
root=E.fromstring(parts['word/document.xml']);body=root.find(tag('w:body'))
frame=deepcopy(root.findall('.//'+tag('wp:inline'))[0]);section=deepcopy(body.find(tag('w:sectPr')));body.clear()
cases=[dict(transforms=[['alpha',v]]) for v in [0,1,25000,50000,60000,70000,99999,100000]]
cases += [dict(transforms=[['alpha',25000],['alpha',70000]]),dict(transforms=[['alpha',70000],['alpha',25000]]),dict(transforms=[['alpha',60000],['lumMod',60000],['lumOff',40000]],scheme=True),dict(transforms=[['lumMod',60000],['lumOff',40000],['alpha',60000]],scheme=True)]
for i,c in enumerate(cases):
 label=add(body,'w:p');pp=add(label,'w:pPr')
 if i:add(pp,'w:pageBreakBefore')
 add(add(label,'w:r'),'w:t',text=f'Text opacity control {i+1}')
 def paragraph(parent,kind):
  p=add(parent,'w:p');pp=add(p,'w:pPr')
  if kind=='body':add(pp,'w:shd',**{'w:val':'clear','w:fill':'D9EAF7'})
  add(pp,'w:spacing',**{'w:after':0,'w:line':1000,'w:lineRule':'exact'})
  rp=add(add(p,'w:r'),'w:rPr');add(rp,'w:rFonts',**{'w:ascii':'Arial','w:hAnsi':'Arial'});add(rp,'w:sz',**{'w:val':72})
  color=effect(effect(effect(rp,'textFill'),'solidFill'),'schemeClr' if c.get('scheme') else 'srgbClr',val='accent1' if c.get('scheme') else 'C02040')
  for name,value in c['transforms']:effect(color,name,val=value)
  add(rp.getparent(),'w:t',text='MWAV '+kind)
 paragraph(body,'body')
 inline=deepcopy(frame);inline.find(tag('wp:docPr')).set('id',str(1000+i))
 content=inline.find('.//'+tag('w:txbxContent'));content.clear();paragraph(content,'shape')
 inline.find('.//'+tag('wps:bodyPr')).set('anchor','t')
 add(add(add(body,'w:p'),'w:r'),'w:drawing').append(inline)
body.append(section);parts['word/document.xml']=E.tostring(root)
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(name,data)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
print(len(cases),'paired opacity controls')
