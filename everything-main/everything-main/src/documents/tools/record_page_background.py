"""Record reference PDF page fills and text colors independently of the renderer."""
from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdfium
import hashlib,json
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/page-background';result={}
for name in ['dark','light']:
 source=root/f'public/fixtures/page-background-{name}.docx';pdf=folder/f'{name}-native.pdf';reader=PdfReader(pdf);rasters=pdfium.PdfDocument(pdf)
 cases=[];backgrounds=[]
 for index,page in enumerate(reader.pages):
  backgrounds.append(list(rasters[index].render(scale=1).to_pil().convert('RGB').getpixel((10,10))))
  state={'color':[0,0,0]};stack=[]
  def operand(op,args,cm,tm):
   if op==b'q':stack.append(dict(state))
   elif op==b'Q' and stack:state.update(stack.pop())
   elif op==b'rg':state['color']=[round(float(v)*255) for v in args]
   elif op==b'g':state['color']=[round(float(args[0])*255)]*3
  def text(value,cm,tm,font,size):
   label=value.strip()
   if label:cases.append(dict(text=label,page=index,color=state['color'],x=tm[4],y=792-tm[5]))
  page.extract_text(visitor_operand_before=operand,visitor_text=text)
 result[name]=dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),backgrounds=backgrounds,cases=cases)
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
