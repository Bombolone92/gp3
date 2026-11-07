"""Extract native inline solid colors from an original SVG reference capture."""
from pathlib import Path
import argparse,hashlib,json,struct,re
from zipfile import ZipFile
from lxml import etree as E
from extract_svg_viewport_metafiles import extract
sha=lambda b:hashlib.sha256(b).hexdigest()

def record(source,out):
 out.mkdir(parents=True,exist_ok=True)
 for file in ['control.docx','cases.json','capture.json','capture.emf']:
  (out/file).write_bytes((source/file).read_bytes())
 metadata=json.loads((out/'capture.json').read_text(encoding='utf-8-sig'))
 assert metadata['sourceUnchanged'] and metadata['readOnly'] and metadata['savedAfter']
 assert metadata['sourceSha256']==sha((out/'control.docx').read_bytes())
 assert metadata['captureSha256']==sha((out/'capture.emf').read_bytes())
 native=extract((out/'capture.emf').read_bytes());(out/'native.emf').write_bytes(native)
 fills=[];position=0
 while position<len(native):
  kind,size=struct.unpack_from('<II',native,position)
  assert size>=8 and position+size<=len(native)
  if kind==70:
   assert native[position+12:position+16]==b'EMF+'
   at=position+16
   while at<position+size:
    typ,flags,length,count=struct.unpack_from('<HHII',native,at)
    assert length>=12 and at+length<=position+size and count<=length-12
    payload=native[at+12:at+12+count]
    if typ==0x4008:
     assert (flags>>8)&127 in [3,4], 'Unexpected object, including font/image'
    elif typ==0x4014:
     assert flags&0x8000 and count==4
     color=struct.unpack('<I',payload)[0]
     fills.append(dict(alpha=color>>24,rgb=f'{color&0xffffff:06X}'))
    at+=length
  position+=size
 with ZipFile(out/'control.docx') as z:svg=z.read('word/media/vector.svg')
 nodes=[n for n in E.fromstring(svg).iter() if E.QName(n).localname in ['rect','path']]
 assert len(nodes)==380 and len(fills)==379
 rows=[];at=0
 for index,node in enumerate(nodes):
  if E.QName(node).localname=='rect':sample=[float(node.get('x'))+float(node.get('width'))/2,float(node.get('y'))+float(node.get('height'))/2]
  else:
   match=re.fullmatch(r'M([\d.]+) ([\d.]+)h3v3h-3z',node.get('d'))
   assert match;sample=[float(match[1])+1.5,float(match[2])+1.5]
  # The explicit zero-opacity control has no native FillPath record.
  if index==64:
   assert node.get('opacity')=='0.0'
   rows.append(dict(index=index,alpha=0,rgb='2060C0',omitted=True,sample=sample));continue
  rows.append(dict(index=index,**fills[at],sample=sample));at+=1
 assert at==len(fills)
 result=dict(referenceBuild=metadata['referenceBuild'],hashes={file:sha((out/file).read_bytes()) for file in ['control.docx','cases.json','capture.json','capture.emf','native.emf']},rows=rows)
 (out/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
 print('Recorded',len(rows),'independent native vector colors; final boundaries:',[r['alpha'] for r in rows[-12:]])

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('output',type=Path)
 a=p.parse_args();record(a.source,a.output)
