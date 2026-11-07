"""Original shape/picture controls for dormant MS-ODRAWXML hiddenLine metadata."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
repo=Path(__file__).resolve().parents[1]
with ZipFile(repo/'public/fixtures/inline-object-baseline.docx') as z: parts={n:z.read(n) for n in z.namelist()}
import struct,zlib
def chunk(t,b): return struct.pack('>I',len(b))+t+b+struct.pack('>I',zlib.crc32(t+b))
parts['word/media/black.png']=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',2,1,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(bytes([0,0,80,80,0,120,0])))+chunk(b'IEND',b'')
root=E.fromstring(parts['word/document.xml']); ns=dict(root.nsmap); ns['a14']='http://schemas.microsoft.com/office/drawing/2010/main';body=root[0]
def tag(s): p,n=s.split(':');return '{'+ns[p]+'}'+n
def add(p,s,**attrs): return E.SubElement(p,tag(s),**attrs)
shape=next(deepcopy(p) for p in body if p.find('.//'+tag('wps:spPr')) is not None)
picture=next(deepcopy(p) for p in body if p.find('.//'+tag('pic:spPr')) is not None)
label=deepcopy(body[0]);sect=deepcopy(body[-1]);body.clear();i=0
for kind,base in [('shape',shape),('picture',picture)]:
 for visible,hidden in [(False,False),(False,True),(True,False),(True,True)]:
  i+=1;l=deepcopy(label);l.find('.//'+tag('w:t')).text=f'{i}: {kind}; visible blue={visible}; hidden red={hidden}';body.append(l)
  p=deepcopy(base);p.find('.//'+tag('w:spacing')).set(tag('w:after'),'160')
  inline=p.find('.//'+tag('wp:inline'));inline.find(tag('wp:docPr')).set('id',str(i));inline.find(tag('wp:docPr')).set('name',f'Control{i}')
  for ex in [inline.find(tag('wp:extent')),p.find('.//'+tag('a:xfrm')+'/'+tag('a:ext'))]: ex.set('cx','1828800');ex.set('cy','304800')
  for nv in p.findall('.//'+tag('pic:cNvPr')): nv.set('id',str(100+i));nv.set('name',f'Picture{i}')
  props=p.find('.//'+tag('wps:spPr')) if kind=='shape' else p.find('.//'+tag('pic:spPr'))
  for fill in props.findall(tag('a:solidFill')):
   fill.find(tag('a:srgbClr')).set('val','008060')
  ln=props.find(tag('a:ln'))
  if ln is not None: props.remove(ln)
  ln=add(props,'a:ln',w='38100');add(add(ln,'a:solidFill'),'a:srgbClr',val='0000FF') if visible else add(ln,'a:noFill')
  if kind=='picture' and not visible: props.remove(ln)
  if hidden:
   ex=add(add(props,'a:extLst'),'a:ext',uri='{91240B29-F687-4F45-9708-019B960494DF}')
   saved=add(ex,'a14:hiddenLine',w='127000');add(add(saved,'a:solidFill'),'a:srgbClr',val='FF0000');add(saved,'a:prstDash',val='dash')
  body.append(p)
body.append(sect);parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(repo/'public/fixtures/hidden-line-controls.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
