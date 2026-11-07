"""Original EMF records and DOCX controls; no document or metafile engine used."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
import struct,sys
ROOT=Path(__file__).resolve().parents[1]
A='http://schemas.openxmlformats.org/drawingml/2006/main';P='http://schemas.openxmlformats.org/drawingml/2006/picture';R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
def ints(*v):return struct.pack('<'+'i'*len(v),*v)
def record(t,p=b''):return struct.pack('<II',t,len(p)+8)+p
def points(t,ps):return record(t,ints(0,0,1000,900,len(ps))+b''.join(struct.pack('<hh' if t>=85 else '<ii',*p) for p in ps))
def emf(case):
 r=[record(17,ints(8)),record(9,ints(1000,900 if case==5 else 450)),record(11,ints(200,90)),record(10,ints(0,0)),record(12,ints(0,0)),record(39,ints(2,0,0xbe5014,0)),record(37,ints(2)),record(95,ints(1,52,0,52,0,0x12200,30,0,0x4020dc,0,0)),record(37,ints(1)),record(58,struct.pack('<f',10) if '--float-miter' in sys.argv else ints(10))]
 def path(ps):r.append(record(59));r.append(record(27,ints(*ps[0])));r.append(points(89,ps[1:]));r.extend([record(61),record(60)])
 def draw(t=62):r.append(record(t,ints(0,0,1000,900)))
 outer=[(100,75),(900,75),(900,375),(100,375)]
 if case==0:
  r.extend([record(59),record(27,ints(100,225)),points(88,[(100,0),(900,0),(900,225),(900,450),(100,450),(100,225)]),record(61),record(60)]);draw()
 elif case==1:
  path([(500,20),(980,225),(500,430),(20,225)]);r.append(record(67,ints(5)));path(outer);draw()
 elif case in [2,3]:
  r.append(record(19,ints(1 if case==2 else 2)));path(outer);r.pop();r.extend([record(27,ints(300,150)),points(89,[(700,150),(700,300),(300,300)]),record(61),record(60)]);draw()
 elif case in [4,5]:
  r.extend([record(59),record(27,ints(100,100)),points(88,[(300,800 if case==5 else 400),(700,-100),(900,800 if case==5 else 350)]),record(60)]);draw(64)
 elif case==6:
  r.extend([record(33),record(35,struct.pack('<6f',.8,.2,-.1,.8,100,25))]);path(outer);draw(63);r.append(record(34,ints(-1)));path([(50,25),(180,25),(180,90),(50,90)]);draw()
 else:
  r.extend([record(59),points(85,[(100,225),(100,0),(900,0),(900,225)]),points(5,[(900,450),(100,450),(100,225)]),record(61),record(60)]);draw(63)
 r.append(record(14,ints(0,0,20)))
 total=88+sum(map(len,r));head=struct.pack('<II4i4iIIIIHHIII4i',1,88,0,0,199,89,0,0,5292,2381,0x464d4520,0x10000,total,len(r)+1,3,0,0,0,0,1280,720,339,190)
 if '--inset-bounds' in sys.argv and case==0:
  head=bytearray(head);struct.pack_into('<4i',head,8,20,11,180,79)
 return head+b''.join(r)
with ZipFile(ROOT/'public/fixtures/shape-defaults.docx') as z:parts={n:z.read(n) for n in z.namelist()}
root=E.fromstring(parts['word/document.xml']);rels=E.fromstring(parts['word/_rels/document.xml.rels']);ns=E.QName(rels).namespace
for i,a in enumerate(root.iter('{'+WP+'}anchor')):
 data=a.find('{'+A+'}graphic/{'+A+'}graphicData');data.clear();data.set('uri',P);pic=E.SubElement(data,'{'+P+'}pic',nsmap={'pic':P});nv=E.SubElement(pic,'{'+P+'}nvPicPr');E.SubElement(nv,'{'+P+'}cNvPr',id='0',name=f'Original EMF {i}');E.SubElement(nv,'{'+P+'}cNvPicPr');fill=E.SubElement(pic,'{'+P+'}blipFill');E.SubElement(fill,'{'+A+'}blip',{'{'+R+'}embed':f'emf{i}'});E.SubElement(E.SubElement(fill,'{'+A+'}stretch'),'{'+A+'}fillRect');pr=E.SubElement(pic,'{'+P+'}spPr');x=E.SubElement(pr,'{'+A+'}xfrm');E.SubElement(x,'{'+A+'}off',x='0',y='0');E.SubElement(x,'{'+A+'}ext',**a.find('{'+WP+'}extent').attrib);E.SubElement(E.SubElement(pr,'{'+A+'}prstGeom',prst='rect'),'{'+A+'}avLst')
 E.SubElement(rels,'{'+ns+'}Relationship',Id=f'emf{i}',Type=R+'/image',Target=f'media/control{i}.emf');parts[f'word/media/control{i}.emf']=emf(i)
parts['word/document.xml']=E.tostring(root);parts['word/_rels/document.xml.rels']=E.tostring(rels)
r=E.fromstring(parts['[Content_Types].xml']);E.SubElement(r,'{'+E.QName(r).namespace+'}Default',Extension='emf',ContentType='image/x-emf');parts['[Content_Types].xml']=E.tostring(r)
with ZipFile(ROOT/('public/fixtures/emf-paths'+('-float-miter' if '--float-miter' in sys.argv else '-inset-bounds' if '--inset-bounds' in sys.argv else '')+'.docx'),'w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
