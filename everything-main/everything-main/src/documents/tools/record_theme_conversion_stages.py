"""Record native text colors and nine interior samples for each color-conversion swatch."""
from pathlib import Path
from hashlib import sha256
import ctypes,json
import pypdfium2 as pdf
import argparse
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('directory',nargs='?',type=Path,default=Path(__file__).resolve().parents[1]/'tests/fixtures/theme-conversion-stages')
parser.add_argument('--reference-build',required=True)
args=parser.parse_args()
root=args.directory
cases=json.loads((root/'cases.json').read_text())
doc=pdf.PdfDocument(root/'native.pdf');found={};images=[]
for pageno,page in enumerate(doc):
 im=page.render(scale=2).to_pil().convert('RGB');images.append(im)
 im.save(root/f'native-{pageno+1}.png')
 text=page.get_textpage()
 for i in range(text.count_chars()-3):
  label=text.get_text_range(i,4)
  if len(label)!=4 or label[0]!='C' or not label[1:].isdigit():continue
  rgba=[ctypes.c_uint()for _ in range(4)]
  assert pdf.raw.FPDFText_GetFillColor(text,i,*[ctypes.byref(v)for v in rgba])
  assert rgba[3].value==255
  assert label not in found
  found[label]=(pageno,[v.value for v in rgba[:3]])
assert len(found)==len(cases)
for case in cases:
 page,case['wml']=found[case['label']];assert page==case['page']
 for swatch in case['swatches']:
  pixels=[images[page].getpixel((2*(swatch['x']+dx),2*(swatch['y']+dy))) for dx in [-5,0,5]for dy in [-5,0,5]]
  assert len(set(pixels))==1,(case['label'],swatch,pixels)
  swatch['rgb']=list(pixels[0])
result=dict(referenceBuild=args.reference_build,hashes={name:sha256((root/name).read_bytes()).hexdigest()for name in ['control.docx','cases.json','native.pdf']},pages=len(doc),cases=cases)
(root/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
print('pages',len(doc),'cases',len(cases))
for j in range(3): print(cases[0]['swatches'][j]['kind'],'matches WML',sum(c['wml']==c['swatches'][j]['rgb']for c in cases))
for j,k in [(0,1),(0,2),(1,2)]:print('path pair',j,k,sum(c['swatches'][j]['rgb']==c['swatches'][k]['rgb']for c in cases))
for c in cases[:12]:print(c['base'],c['mode'],c['value'],'WML',c['wml'],'swatches',[s['rgb']for s in c['swatches']])
