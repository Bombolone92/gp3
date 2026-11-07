from pathlib import Path
from pypdf import PdfReader
import json,hashlib,re
folder=Path('tests/fixtures/body-overflow-indents')
lines=[]
for i,p in enumerate(PdfReader(folder/'control-native.pdf').pages):
 rows={}
 def visit(t,cm,tm,font,size):
  if t.strip():
   key=round(tm[5],2)
   rows.setdefault(key,[]).append((tm[4],t))
 p.extract_text(visitor_text=visit)
 for y,parts in rows.items():
  parts.sort()
  text=''.join(t for x,t in parts).strip()
  # The reference PDF splits long text operations without retaining boundary spaces.
  tokens=re.findall(r'(?:word|left|both)\d{2}',text)
  if tokens:text=' '.join(tokens)
  lines.append(dict(page=i,text=text,x=parts[0][0],y=float(p.mediabox.height)-y))
(folder/'reference.json').write_text(json.dumps({'lines':lines,'hashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [folder/'control.docx',folder/'control-native.pdf']}},indent=2)+'\n')

