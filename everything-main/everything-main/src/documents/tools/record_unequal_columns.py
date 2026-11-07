from pypdf import PdfReader
from pathlib import Path
import json,hashlib,re
root=Path(__file__).resolve().parents[1]/'tests/fixtures/unequal-columns'
result={}
for f in root.glob('*.pdf'):
 rows=[];separators=[]
 for page,p in enumerate(PdfReader(f).pages):
  height=float(p.mediabox.height)
  def visit(text,ctm,matrix,font,size):
   if not text.strip():return
   x=round(matrix[4],3);baseline=round(height-matrix[5],3)
   # PDF text objects can split a word on the same physical line.
   if rows and rows[-1]['page']==page and abs(rows[-1]['baseline']-baseline)<.01 and (rows[-1]['x']>=143.9)==(x>=143.9) and x>rows[-1]['x']:
    rows[-1]['text']+=text.rstrip('\n')
   else:rows.append(dict(page=page,text=text.rstrip('\n'),x=x,baseline=baseline))
  p.extract_text(visitor_text=visit)
  for x,y,w,h in re.findall(r'([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re\s+f\*',p.get_contents().get_data().decode('latin1')):
   if float(w)<2:separators.append(dict(page=page,x=float(x),y=height-float(y)-float(h),width=float(w),height=float(h)))
 for row in rows:row['text']=row['text'].strip()
 result[f.stem]=dict(pages=len(PdfReader(f).pages),rows=rows,separators=separators,sha256={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in [f.name,f.stem+'.docx']})
 print(f.stem, result[f.stem]['pages'],rows[:4],rows[-3:],separators)
(root/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
