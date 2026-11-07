"""Verify original controlled font changes and extract native reference script data."""
from pathlib import Path
from pypdf import PdfReader
import hashlib,json,struct
root=Path(__file__).resolve().parents[1]/'tests/fixtures/script-metric-controls'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def tables(b):
 return {b[12+i*16:16+i*16].decode():b[off:off+length] for i in range(struct.unpack_from('>H',b,4)[0]) for off,length in [struct.unpack_from('>II',b,20+i*16)]}
source=root.parents[2]/'public/fonts/BebasNeue-Regular.ttf';original=tables(source.read_bytes())
fonts=json.loads((root/'fonts.json').read_text());reader=PdfReader(root/'controls-native.pdf');assert len(reader.pages)==len(fonts)==18
pages=[]
for filename,page in zip(fonts,reader.pages):
 path=root/filename;b=path.read_bytes();font=tables(b)
 padded=b+b'\0'*((-len(b))%4);assert sum(struct.unpack('>'+str(len(padded)//4)+'I',padded))&0xffffffff==0xb1b0afba
 for tag in ['glyf','loca','hmtx','hhea','cmap','GSUB','GPOS']:assert font[tag]==original[tag],(filename,tag)
 fields=struct.unpack_from('>8h',font['OS/2'],10);units=struct.unpack_from('>H',font['head'],18)[0]
 runs=[]
 def visit(t,c,m,f,s):
  if t.strip() not in ['START TEST END','START','TEST','END']:return
  assert str(f['/BaseFont']).split('+')[-1]==path.stem,(filename,f['/BaseFont'])
  runs.append(dict(text=t.strip(),fontSize=s,x=m[4]*c[0]+m[5]*c[2]+c[4],y=m[4]*c[1]+m[5]*c[3]+c[5],scaleX=m[0]*c[0],scaleY=m[3]*c[3]))
 page.extract_text(visitor_text=visit)
 assert len(runs)==7 and [r['text'] for r in runs]==['START TEST END','START','TEST','END','START','TEST','END']
 script=[]
 for start,text,end in [runs[1:4],runs[4:7]]:
  script.append(dict(size=text['fontSize'],rise=text['y']-start['y'],origin=text['x'],followingOrigin=end['x'],matrixX=text['scaleX'],matrixY=text['scaleY']))
 pages.append(dict(font=filename,fontSha256=sha(path),unitsPerEm=units,os2ScriptMetrics=fields,superscript=script[0],subscript=script[1]))
(root/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',baseFontSha256=sha(source),sourceSha256=sha(root/'controls.docx'),pdfSha256=sha(root/'controls-native.pdf'),pages=pages),indent=2)+'\n')
print('Verified all 18 font identities, unchanged glyphs and checksums; extracted native script geometry')
