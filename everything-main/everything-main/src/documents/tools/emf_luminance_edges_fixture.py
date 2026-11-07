"""Original EMF outline controls: paired black and brightness-adjusted white paths."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import struct, json, argparse

parser=argparse.ArgumentParser()
parser.add_argument('--variant',choices=['base','inset-bounds','expanded-frame','overflow-frame'],default='base')
args=parser.parse_args()

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / ('tests/fixtures/emf-luminance-edges' + ('' if args.variant=='base' else '-'+args.variant))
OUT.mkdir(exist_ok=True)
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
P = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'

def ints(*values): return struct.pack('<' + 'i'*len(values), *values)
def record(kind, payload=b''): return struct.pack('<II', kind, len(payload)+8) + payload
def emf(white):
    color = 0xffffff if white else 0
    records = [record(17, ints(1)), record(37, struct.pack('<I', 0x80000005)),
               record(95, ints(1,52,0,52,0,0x12200,6,0,color,0,0)), record(37,ints(1))]
    for points, close in [([(3,3),(123,3),(123,121),(3,121)], True),
                          ([(25,90),(63,30),(101,90)], False)]:
        records += [record(59), record(27, ints(*points[0]))]
        records += [record(54, ints(*point)) for point in points[1:]]
        if close: records.append(record(61))
        records += [record(60), record(64, ints(0,0,126,124))]
    records.append(record(14, ints(0,0,20)))
    header = struct.pack('<II4i4iIIIIHHIII4i',1,88,0,0,126,124,0,0,3334,3281,
                         0x464d4520,0x10000,88+sum(map(len,records)),len(records)+1,
                         2,0,0,0,0,960,960,254,254)
    header=bytearray(header)
    if args.variant=='inset-bounds': struct.pack_into('<4i',header,8,30,30,96,94)
    if args.variant=='expanded-frame': struct.pack_into('<4i',header,24,0,0,6668,6562)
    if args.variant=='overflow-frame': struct.pack_into('<4i',header,24,0,0,3281,3228)
    return header+b''.join(records)

with ZipFile(ROOT/'public/fixtures/shape-defaults.docx') as z:
    parts = {name:z.read(name) for name in z.namelist()}
root=E.fromstring(parts['word/document.xml'])
rels=E.fromstring(parts['word/_rels/document.xml.rels']); relns=E.QName(rels).namespace
cases=[]
for i, anchor in enumerate(root.iter('{'+WP+'}anchor')):
    row=i//2; white=bool(i%2); width,height=[(64,63),(96,94.5),(128,126),(64.35,63.63)][row]
    extent=anchor.find('{'+WP+'}extent'); extent.set('cx',str(round(width*9525))); extent.set('cy',str(round(height*9525)))
    data=anchor.find('{'+A+'}graphic/{'+A+'}graphicData'); data.clear(); data.set('uri',P)
    pic=E.SubElement(data,'{'+P+'}pic',nsmap={'pic':P})
    nv=E.SubElement(pic,'{'+P+'}nvPicPr'); E.SubElement(nv,'{'+P+'}cNvPr',id='0',name=f'Edge {i}'); E.SubElement(nv,'{'+P+'}cNvPicPr')
    fill=E.SubElement(pic,'{'+P+'}blipFill'); blip=E.SubElement(fill,'{'+A+'}blip',{'{'+R+'}embed':f'edge{i}'})
    if white: E.SubElement(blip,'{'+A+'}lum',bright='-100000')
    E.SubElement(E.SubElement(fill,'{'+A+'}stretch'),'{'+A+'}fillRect')
    pr=E.SubElement(pic,'{'+P+'}spPr'); x=E.SubElement(pr,'{'+A+'}xfrm')
    E.SubElement(x,'{'+A+'}off',x='0',y='0'); E.SubElement(x,'{'+A+'}ext',**extent.attrib)
    E.SubElement(E.SubElement(pr,'{'+A+'}prstGeom',prst='rect'),'{'+A+'}avLst')
    parts[f'word/media/edge{i}.emf']=emf(white)
    E.SubElement(rels,'{'+relns+'}Relationship',Id=f'edge{i}',Type=R+'/image',Target=f'media/edge{i}.emf')
    cases.append(dict(id=i,brightness=-100000 if white else None,widthPx=width,heightPx=height))
parts['word/document.xml']=E.tostring(root);parts['word/_rels/document.xml.rels']=E.tostring(rels)
types=E.fromstring(parts['[Content_Types].xml'])
E.SubElement(types,'{'+E.QName(types).namespace+'}Default',Extension='emf',ContentType='image/x-emf')
parts['[Content_Types].xml']=E.tostring(types)
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items():z.writestr(name,data)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
