"""Original tiny raster controls with large, valid non-pixel metadata."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from PIL import Image
from io import BytesIO
import struct,zlib,json
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tests/fixtures/large-raster-parts';OUT.mkdir(exist_ok=True)
A='http://schemas.openxmlformats.org/drawingml/2006/main';W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
im=Image.new('RGB',(64,32));im.putdata([(20,100,190) if x<32 else (190,40,120) for y in range(32) for x in range(64)])
b=BytesIO();im.save(b,'JPEG',quality=95,subsampling=0);small=b.getvalue();segment=b'\xff\xfe'+struct.pack('>H',65535)+b'p'*65533
large=small[:2]+segment*177+small[2:]
b=BytesIO();im.save(b,'PNG');png=b.getvalue();payload=b'padding\0'+b'p'*(11*1024*1024);kind=b'tEXt';chunk=struct.pack('>I',len(payload))+kind+payload+struct.pack('>I',zlib.crc32(kind+payload)&0xffffffff);png=png[:33]+chunk+png[33:]
with ZipFile(ROOT/'public/fixtures/picture-duotone.docx') as z:parts={n:z.read(n) for n in z.namelist() if not n.startswith('word/media/')}
r=E.fromstring(parts['word/document.xml']);body=r.find('{'+W+'}body');heading=deepcopy(body[0]);label=deepcopy(body[1]);picture=deepcopy(body[2]);section=deepcopy(body[-1]);body.clear();heading.find('.//{'+W+'}t').text='Large encoded raster controls';body.append(heading)
rels=E.fromstring(parts['word/_rels/document.xml.rels']);relNS='http://schemas.openxmlformats.org/package/2006/relationships'
for n in list(rels):
 if n.get('Type')==R+'/image':rels.remove(n)
cases=[]
for i,(name,data,mime) in enumerate([('small.jpg',small,'image/jpeg'),('large.jpg',large,'image/jpeg'),('large.png',png,'image/png')]):
 parts['word/media/'+name]=data;E.SubElement(rels,'{'+relNS+'}Relationship',Id='raster'+str(i),Type=R+'/image',Target='media/'+name)
 l=deepcopy(label);l.find('.//{'+W+'}t').text=name;body.append(l);p=deepcopy(picture);blip=p.find('.//{'+A+'}blip');blip.set('{'+R+'}embed','raster'+str(i))
 for c in list(blip):blip.remove(c)
 for n in p.iter():
  if E.QName(n).localname in ['docPr','cNvPr']:n.set('id',str(i+1));n.set('name',name)
 body.append(p);cases.append(dict(name=name,bytes=len(data),mime=mime,width=64,height=32))
body.append(section);parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True);parts['word/_rels/document.xml.rels']=E.tostring(rels)
ct=E.fromstring(parts['[Content_Types].xml']);ctns='http://schemas.openxmlformats.org/package/2006/content-types'
E.SubElement(ct,'{'+ctns+'}Default',Extension='jpg',ContentType='image/jpeg');parts['[Content_Types].xml']=E.tostring(ct)
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
