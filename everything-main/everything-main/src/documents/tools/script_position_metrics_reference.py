"""Verify one-metric font controls and extract native reference script positions."""
from pathlib import Path
from pypdf import PdfReader
import argparse,hashlib,json,struct
from zipfile import ZipFile
from xml.etree import ElementTree as ET
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--verify-source-only',action='store_true')
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]/'tests/fixtures/script-position-metrics'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def tables(b):
 return {b[12+i*16:16+i*16].decode():b[o:o+n] for i in range(struct.unpack_from('>H',b,4)[0]) for o,n in [struct.unpack_from('>II',b,20+i*16)]}
source=root.parents[2]/'public/fonts/BebasNeue-Regular.ttf';base=tables(source.read_bytes())
cases=json.loads((root/'cases.json').read_text())
assert len(cases)==14
assert json.loads((root/'fonts.json').read_text())==[c['family'].replace(' ','')+'.ttf' for c in cases]
w='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
with ZipFile(root/'controls.docx') as package:
 assert set(package.namelist())=={'[Content_Types].xml','_rels/.rels','word/document.xml'}
 body=ET.fromstring(package.read('word/document.xml')).find(w+'body')
 paragraphs=body.findall(w+'p')
 assert len(paragraphs)==70
 for i,case in enumerate(cases):
  label=paragraphs[5*i]
  assert ''.join(label.itertext())==case['family']
  assert (label.find(w+'pPr/'+w+'pageBreakBefore') is not None)==(i>0)
  assert case['rows']==[dict(size=size,script=script) for size in [12,20] for script in ['superscript','subscript']]
  for p,row in zip(paragraphs[5*i+1:5*i+5],case['rows']):
   runs=p.findall(w+'r');assert len(runs)==3
   assert [r.find(w+'t').text for r in runs]==['START ','TEST',' END']
   for j,r in enumerate(runs):
    props=r.find(w+'rPr')
    assert props.find(w+'rFonts').attrib=={w+'ascii':case['family'],w+'hAnsi':case['family']}
    assert props.find(w+'sz').get(w+'val')==str(row['size']*2)
    align=props.find(w+'vertAlign')
    assert (align is None) if j!=1 else align.get(w+'val')==row['script']
rows=[];fonts={}
for case in cases:
 path=root/(case['family'].replace(' ','')+'.ttf');data=path.read_bytes();t=tables(data)
 padded=data+b'\0'*((-len(data))%4);assert sum(struct.unpack('>'+str(len(padded)//4)+'I',padded))&0xffffffff==0xb1b0afba
 assert set(t)==set(base)-{'DSIG'}
 assert t['head'][:8]==base['head'][:8] and t['head'][12:]==base['head'][12:]
 for tag in base:
  if tag in ['name','head','DSIG']:continue
  expected=bytearray(base[tag])
  for offset,value in case['changes'].get(tag,{}).items():struct.pack_into('>h',expected,int(offset),value)
  assert t[tag]==expected,(path.name,tag)
 font=dict(sha256=sha(path),unitsPerEm=struct.unpack_from('>H',t['head'],18)[0],scriptMetrics=list(struct.unpack_from('>8h',t['OS/2'],10)),win=list(struct.unpack_from('>HH',t['OS/2'],74)),typo=list(struct.unpack_from('>hhh',t['OS/2'],68)),hhea=list(struct.unpack_from('>hhh',t['hhea'],4)))
 fonts[case['family']]=font
print('Verified 14 font variants: unchanged glyphs, advances and hinting; 56 matching source rows')
if args.verify_source_only:
 raise SystemExit(0)
pdf=PdfReader(root/'controls-native.pdf')
assert len(pdf.pages)==len(cases)
for case,page in zip(cases,pdf.pages):
 path=root/(case['family'].replace(' ','')+'.ttf');runs=[]
 def visit(text,c,m,f,size):
  if text.strip() not in ['START','TEST','END']:return
  assert c[:4]==[1,0,0,1] and m[:4]==[1,0,0,1]
  assert str(f['/BaseFont']).split('+')[-1]==path.stem,(case['family'],f['/BaseFont'])
  runs.append(dict(text=text.strip(),size=size,x=m[4],y=m[5]))
 page.extract_text(visitor_text=visit)
 assert len(runs)==12,(case['family'],runs)
 for i,row in enumerate(case['rows']):
  start,script,end=runs[i*3:i*3+3];assert [r['text'] for r in [start,script,end]]==['START','TEST','END']
  rows.append(dict(family=case['family'],mode=case['mode'],variant=case['variant'],**row,nativeSize=script['size'],rise=script['y']-start['y'],scriptX=script['x'],followingX=end['x']))
result=dict(referenceVersion='16.0.20326',baseFontSha256=sha(source),hashes={n:sha(root/n) for n in ['controls.docx','controls-native.pdf','cases.json','fonts.json']},fonts=fonts,rows=rows)
(root/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
for case in cases:print(case['family'],[(r['size'],r['script'],round(r['rise'],3)) for r in rows if r['family']==case['family']])
print('Verified 56 native runs, exact face identities, unchanged glyphs and checksums')
