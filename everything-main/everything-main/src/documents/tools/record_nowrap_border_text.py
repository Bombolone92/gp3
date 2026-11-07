"""Record native text origins independently of border/shading inset geometry."""
from pathlib import Path
from hashlib import sha256
import ctypes,json,sys
import pypdfium2 as pdf
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/nowrap-cell-margins'
name=sys.argv[1] if len(sys.argv)>1 else 'bordered'
cases=json.loads((folder/'cases.json').read_text());doc=pdf.PdfDocument(folder/(name+'-native.pdf'));assert len(doc)==len(cases)
pages=[]
for page in doc:
 text=page.get_textpage();chars=''.join(text.get_text_range(i,1)for i in range(text.count_chars()));row=[];start=0
 for label in ['A0','B0','C0','C0']:
  index=chars.index(label,start);start=index+len(label);x,y=ctypes.c_double(),ctypes.c_double();pdf.raw.FPDFText_GetCharOrigin(text,index,ctypes.byref(x),ctypes.byref(y));row.append(dict(x=x.value,baseline=page.get_height()-y.value))
 pages.append(row)
out=dict(referenceVersion='16.0.20326',hashes={n:sha256((folder/n).read_bytes()).hexdigest()for n in [name+'.docx','cases.json',name+'-native.pdf']},cases=cases,pages=pages)
(folder/(name+'-text-reference.json')).write_text(json.dumps(out,indent=2)+'\n')
