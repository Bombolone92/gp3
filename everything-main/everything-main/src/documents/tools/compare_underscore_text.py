from pathlib import Path
import argparse
parser=argparse.ArgumentParser();parser.add_argument("app_png");parser.add_argument("--output",default="underscore-comparison.json");args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
import pypdfium2 as pdfium,numpy as np,json
from PIL import Image
pdf=pdfium.PdfDocument(str(root/'tests/fixtures/underscore-text/native.pdf'));page=pdf[0];text=page.get_textpage();full=text.get_text_range();indices=[];start=0
while (i:=full.find('____________',start))>=0:indices.append(i);start=i+12
if len(indices)!=12:raise RuntimeError('Expected twelve underscore runs in the native reference')
bitmap=page.render(scale=4/3)
images={'word':np.asarray(bitmap.to_pil().convert('RGB')).copy(),'app':np.asarray(Image.open(args.app_png).convert('RGB'))}
bitmap.close()
if images["word"].shape!=images["app"].shape:raise RuntimeError("Expected a 96-DPI full-page browser capture")
rows=[]
for k,i in enumerate(indices):
 boxes=[text.get_charbox(j)for j in range(i,i+12)];left=min(b[0]for b in boxes);right=max(b[2]for b in boxes);top=792-max(b[3]for b in boxes);bottom=792-min(b[1]for b in boxes)
 row={'font':'Trebuchet MS'if k<6 else'Arial','size':[12,16,28][(k%6)//2],'spacingTwips':k%2,'nativeBounds':[left,top,right,bottom]}
 for name,a in images.items():
  x0=int(np.ceil(left*4/3))+2;x1=int(np.floor(right*4/3))-2;y0=int(np.floor(top*4/3))-2;y1=int(np.ceil(bottom*4/3))+2
  coverage=a[y0:y1,x0:x1].min(axis=(0,2));row[name]={'whiteColumns':int((coverage==255).sum()),'faintColumns':int((coverage>220).sum()),'minimum':int(coverage.min()),'maximum':int(coverage.max())}
 rows.append(row)
print(json.dumps(rows,indent=2));Path(args.output).write_text(json.dumps(rows,indent=2)+'\n');text.close();page.close();pdf.close()
