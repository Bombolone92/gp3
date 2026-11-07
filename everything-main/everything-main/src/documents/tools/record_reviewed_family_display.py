"""Record original reference EMF glyph advances separately from the PDF oracle."""
from pathlib import Path
import json,struct,hashlib
from zipfile import ZipFile
from lxml import etree
from inspect_emf_text_records import inspect
root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/empty-gpos-kerning';source=root/'public/fixtures/reviewed-family.docx';path=folder/'reviewed-family.emf';data=path.read_bytes()
frame=struct.unpack_from('<4i',data,24);extent=None;offset=0
while offset<len(data):
 kind,size=struct.unpack_from('<II',data,offset)
 if kind in (35,36):raise ValueError('Unexpected world transform')
 if kind==9:
  current=struct.unpack_from('<2i',data,offset+8)
  if extent and current!=extent:raise ValueError('Varying window extents')
  extent=current
 if kind in (10,12) and struct.unpack_from('<2i',data,offset+8)!=(0,0):raise ValueError('Nonzero origin')
 offset+=size
assert extent and frame[0]==0 and frame[1]==0
scale=(frame[2]-frame[0])/2540*72/extent[0]
with ZipFile(source)as z:
 xml=etree.fromstring(z.read('word/document.xml'));left=float(xml.find('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}pgMar').get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}left'))/20
rows=[]
for r in inspect(data):
 text=r['text'].rstrip()
 if not text:continue
 assert r['advanceDimensions']==1 and len(r['advances'])==len(r['text'])
 x=left+r['logicalOrigin'][0]*scale;glyphs=[]
 for advance in r['advances'][:len(text)]:glyphs.append(x);x+=advance*scale
 rows.append({'text':text,'glyphs':glyphs,'font':r['font']})
assert len(rows)==10
h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
(folder/'reviewed-family-display.json').write_text(json.dumps({'referenceBuild':'16.0.20326','sourceSha256':h(source),'emfSha256':h(path),'logicalUnitPt':scale,'rows':rows},indent=2)+'\n')
