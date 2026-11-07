"""Record native images and text fonts without consulting app layout."""
from pathlib import Path
from pypdf import PdfReader
import hashlib,json
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/styles-with-effects'
cases=[]
for name,pdf_name in [('control','native.pdf'),('runs','runs-native.pdf')]:
    pictures=[];texts=[]
    for index,page in enumerate(PdfReader(folder/pdf_name).pages):
        def image(op,args,cm,tm):
            if op==b'Do':pictures.append(dict(page=index,x=cm[4],y=float(page.mediabox.height)-cm[5]-cm[3],width=cm[0],height=cm[3]))
        def text(value,cm,tm,font,size):
            if value.strip():texts.append(dict(page=index,text=value.strip(),font=str(font.get('/BaseFont')) if font else None,size=size))
        page.extract_text(visitor_operand_before=image,visitor_text=text)
    if len(pictures)!=18:raise ValueError('Expected six three-cell picture tables')
    cases.append(dict(name=name,pictures=pictures,texts=texts,hashes={n:hashlib.sha256((folder/n).read_bytes()).hexdigest() for n in [name+'.docx',pdf_name]}))
(folder/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',units='points, top-left page coordinates',cases=cases),indent=2)+'\n',encoding='utf-8')
