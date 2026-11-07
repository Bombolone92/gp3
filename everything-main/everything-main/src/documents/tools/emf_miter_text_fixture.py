"""Original paths and logical fonts distinguish native text-bearing miter playback."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import struct, json, argparse
parser=argparse.ArgumentParser()
parser.add_argument('--variant',choices=['context','integers','empty','effects'],default='context')
parser.add_argument('--output',type=Path)
args=parser.parse_args()


ROOT = Path(__file__).resolve().parents[1]
OUT = args.output or ROOT / ('tests/fixtures/'+{'context':'emf-miter-text','integers':'emf-miter-text-integers','empty':'emf-miter-text-empty-buffers','effects':'emf-miter-text-effects'}[args.variant])
OUT.mkdir(exist_ok=True)
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
P = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'

def ints(*values): return struct.pack('<' + 'i'*len(values), *values)
def record(kind, payload=b''): return struct.pack('<II', kind, len(payload)+8) + payload
CASES = [('plain',0,'08000000'),('text',1,'08000000'),('font-only',2,'08000000'),('valid-miter-text',1,'00000041')]
if args.variant=='integers': CASES=[('uint1-text',1,'01000000'),('uint2-text',1,'02000000'),('uint8-text',1,'08000000'),('uint10-text',1,'0a000000')]
if args.variant=='empty': CASES=[('plain',0,'08000000'),('empty-text',3,'08000000'),('space-text',4,'08000000'),('text',1,'08000000')]
if args.variant=='effects': CASES=[(effect,1,'08000000') for effect in ['grayscale','duotone','color-change','alpha']]
def emf(white, case):
    color = 0xffffff if white else 0
    if white and args.variant=='effects': color=0x0050b0
    records = [record(17, ints(1)), record(37, struct.pack('<I', 0x80000005)),
               record(95, ints(1,52,0,52,0,0x12200,6,0,color,0,0)), record(37,ints(1))]
    records.append(record(58,bytes.fromhex(case[2])))
    for points, close in [([(3,3),(123,3),(123,121),(3,121)], True),
                          ([(45,95),(63,20),(81,95)], False)]:
        records += [record(59), record(27, ints(*points[0]))]
        records += [record(54, ints(*point)) for point in points[1:]]
        if close: records.append(record(61))
        records += [record(60), record(64, ints(0,0,126,124))]
    if case[1]:
        font=bytearray(320);struct.pack_into('<5i8B',font,0,-12,0,0,0,400,0,0,0,0,0,0,0,0)
        font[28:40]='Arial\0'.encode('utf-16-le')
        records.extend([record(18,ints(1)),record(22,ints(24)),record(24,ints(color)),record(82,ints(2)+font),record(37,ints(2))])
        if case[1]!=2:
            payload=ints(0,0,126,124,1)+struct.pack('<2f',1,1)+ints(60,110,1,76,0,0,0,0,0,80)+(b' \0\0\0' if case[1]==4 else b'I\0\0\0')+ints(8)
            if case[1]==3: payload=ints(0,0,126,124,1)+struct.pack('<2f',1,1)+ints(60,110,0,0,0,0,0,0,0,0)
            records.append(record(84,payload))
    records.append(record(14, ints(0,0,20)))
    header = struct.pack('<II4i4iIIIIHHIII4i',1,88,0,0,126,124,0,0,3334,3281,
                         0x464d4520,0x10000,88+sum(map(len,records)),len(records)+1,
                         3,0,0,0,0,960,960,254,254)
    header=bytearray(header)
    return header+b''.join(records)

with ZipFile(ROOT/'public/fixtures/shape-defaults.docx') as z:
    parts = {name:z.read(name) for name in z.namelist()}
root=E.fromstring(parts['word/document.xml'])
rels=E.fromstring(parts['word/_rels/document.xml.rels']); relns=E.QName(rels).namespace
cases=[]
for i, anchor in enumerate(root.iter('{'+WP+'}anchor')):
    row=i//2; white=bool(i%2); width,height=(128,126); case=CASES[row]
    extent=anchor.find('{'+WP+'}extent'); extent.set('cx',str(round(width*9525))); extent.set('cy',str(round(height*9525)))
    data=anchor.find('{'+A+'}graphic/{'+A+'}graphicData'); data.clear(); data.set('uri',P)
    pic=E.SubElement(data,'{'+P+'}pic',nsmap={'pic':P})
    nv=E.SubElement(pic,'{'+P+'}nvPicPr'); E.SubElement(nv,'{'+P+'}cNvPr',id='0',name=f'Edge {i}'); E.SubElement(nv,'{'+P+'}cNvPicPr')
    fill=E.SubElement(pic,'{'+P+'}blipFill'); blip=E.SubElement(fill,'{'+A+'}blip',{'{'+R+'}embed':f'edge{i}'})
    if white:
        if args.variant!='effects': E.SubElement(blip,'{'+A+'}lum',bright='-100000')
        elif case[0]=='grayscale': E.SubElement(blip,'{'+A+'}grayscl')
        elif case[0]=='duotone':
            effect=E.SubElement(blip,'{'+A+'}duotone')
            for rgb in ['0000FF','FFFF00']: E.SubElement(effect,'{'+A+'}srgbClr',val=rgb)
        elif case[0]=='color-change':
            effect=E.SubElement(blip,'{'+A+'}clrChange',useA='1')
            for tag,rgb in [('clrFrom','B05000'),('clrTo','0000FF')]: E.SubElement(E.SubElement(effect,'{'+A+'}'+tag),'{'+A+'}srgbClr',val=rgb)
        else: E.SubElement(blip,'{'+A+'}alphaModFix',amt='50000')
    E.SubElement(E.SubElement(fill,'{'+A+'}stretch'),'{'+A+'}fillRect')
    pr=E.SubElement(pic,'{'+P+'}spPr'); x=E.SubElement(pr,'{'+A+'}xfrm')
    E.SubElement(x,'{'+A+'}off',x='0',y='0'); E.SubElement(x,'{'+A+'}ext',**extent.attrib)
    E.SubElement(E.SubElement(pr,'{'+A+'}prstGeom',prst='rect'),'{'+A+'}avLst')
    parts[f'word/media/edge{i}.emf']=emf(white,case)
    E.SubElement(rels,'{'+relns+'}Relationship',Id=f'edge{i}',Type=R+'/image',Target=f'media/edge{i}.emf')
    cases.append(dict(id=i,miterCase=case[0],textMode=case[1],recordHex=case[2],brightness=-100000 if white else None,widthPx=width,heightPx=height))
    if args.variant=='effects': cases[-1]['brightness']=None; cases[-1]['effect']=case[0] if white else None
parts['word/document.xml']=E.tostring(root);parts['word/_rels/document.xml.rels']=E.tostring(rels)
types=E.fromstring(parts['[Content_Types].xml'])
E.SubElement(types,'{'+E.QName(types).namespace+'}Default',Extension='emf',ContentType='image/x-emf')
parts['[Content_Types].xml']=E.tostring(types)
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items():z.writestr(name,data)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
