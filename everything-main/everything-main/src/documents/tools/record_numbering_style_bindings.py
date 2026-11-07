"""Record reference PDF markers and origins independently of the document renderer."""
from pathlib import Path
import ctypes, hashlib, json, re
import pypdfium2 as pdf

root=Path(__file__).resolve().parents[1]/'tests/fixtures/numbering-style-bindings'
cases=json.loads((root/'cases.json').read_text())
native=json.loads((root/'native.json').read_text(encoding='utf-8-sig'))
document=pdf.PdfDocument(root/'native.pdf')
positions=[]
for page_index,page in enumerate(document):
 text=page.get_textpage()
 contents=text.get_text_range()
 def origin(index):
  x,y=ctypes.c_double(),ctypes.c_double()
  if not pdf.raw.FPDFText_GetCharOrigin(text,index,ctypes.byref(x),ctypes.byref(y)):raise RuntimeError('Missing native origin')
  return x.value,page.get_height()-y.value
 for match in re.finditer(r'N(\d{2}) ',contents):
  index=int(match[1]);start=contents.rfind('\n',0,match.start())+1
  prefix=contents[start:match.start()].strip()
  if prefix!=native['cases'][index]['marker']:raise RuntimeError(f'Reference automation/PDF disagree for {index}: {prefix}')
  x,y=origin(match.start())
  positions.append(dict(index=index,page=page_index,textX=x,baselineY=y,marker=prefix,
                        markerX=origin(start)[0] if prefix else None))
 page.render(scale=96/72).to_pil().save(root/f'native-{page_index+1}.png')
if sorted(p['index']for p in positions)!=list(range(len(cases))):raise RuntimeError('Missing or duplicate cases')
result=dict(referenceBuild=native['referenceBuild'],pages=len(document),positions=positions,
            hashes={name:hashlib.sha256((root/name).read_bytes()).hexdigest()for name in ['control.docx','cases.json','native.pdf','native.json']})
(root/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
print(f'Confirmed {len(positions)} native markers and origins on {len(document)} pages')
