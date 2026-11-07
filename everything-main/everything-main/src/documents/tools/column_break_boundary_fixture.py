"""Original controls for column breaks at the writing-area boundary."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as E
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/column-break-boundaries';OUT.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';E.register_namespace('w',W)
def add(p,tag,**attrs):return E.SubElement(p,'{'+W+'}'+tag,{'{'+W+'}'+k:str(v) for k,v in attrs.items()})
with ZipFile(ROOT/'public/fixtures/exhausted-cell-indents.docx') as z:base={n:z.read(n) for n in z.namelist()}
for name,count,cols in [('near',26,2),('full',27,2),('single',27,1),('repeated',27,2),('terminal',27,2),('large',26,2),('spaced',27,2),('keep',27,2),('spaced-suppressed',27,2),('spaced-after',27,2),('spaced-repeated',27,2)]:
 parts=base.copy();r=E.Element('{'+W+'}document');b=add(r,'body')
 def para(text='',keep=False):
  p=add(b,'p');pr=add(p,'pPr')
  if keep:add(pr,'keepNext')
  add(pr,'spacing',before=0,after=0,line=240,lineRule='exact')
  if text:run(p,text)
  return p
 def run(p,text=None,br=False,sz=20):
  q=add(p,'r');pr=add(q,'rPr');add(pr,'rFonts',ascii='Arial',hAnsi='Arial');add(pr,'sz',val=sz)
  if br:add(q,'br',type='column')
  else:add(q,'t').text=text
 for i in range(count):
  previous=para(f'Before {i+1:02}',name=='keep' and i==count-1)
  if name=='spaced-after' and i==count-1:previous.find('./{'+W+'}pPr/{'+W+'}spacing').set('{'+W+'}after','120')
 p=para()
 spacing=p.find('./{'+W+'}pPr/{'+W+'}spacing')
 if name=='large':spacing.set('{'+W+'}lineRule','atLeast')
 if name.startswith('spaced'):spacing.set('{'+W+'}before','240')
 run(p,br=True,sz=72 if name=='large' else 20)
 if name in ['repeated','spaced-repeated']:run(p,br=True)
 if name=='terminal':p=para()
 run(p,'After')
 s=add(b,'sectPr');add(s,'pgSz',w=6120,h=7920);add(s,'pgMar',top=720,right=720,bottom=720,left=720,header=360,footer=360,gutter=0);add(s,'cols',num=cols,space=360)
 if name=='spaced-suppressed':
  settings=E.Element('{'+W+'}settings');compat=add(settings,'compat');add(compat,'suppressSpBfAfterPgBrk')
  parts['word/settings.xml']=E.tostring(settings)
  rels=E.fromstring(parts['word/_rels/document.xml.rels'])
  E.SubElement(rels,'{http://schemas.openxmlformats.org/package/2006/relationships}Relationship',{'Id':'settings','Type':'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings','Target':'settings.xml'})
  parts['word/_rels/document.xml.rels']=E.tostring(rels)
  ct=E.fromstring(parts['[Content_Types].xml'])
  E.SubElement(ct,'{http://schemas.openxmlformats.org/package/2006/content-types}Override',{'PartName':'/word/settings.xml','ContentType':'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml'})
  parts['[Content_Types].xml']=E.tostring(ct)
 parts['word/document.xml']=E.tostring(r)
 with ZipFile(OUT/(name+'.docx'),'w',ZIP_DEFLATED) as z:
  for n,v in parts.items():z.writestr(n,v)
