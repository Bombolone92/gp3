"""Retain independently exported reference pages; no engine geometry is imported."""
from pathlib import Path
import hashlib, json, argparse
import pypdfium2 as pdf
from PIL import Image
parser=argparse.ArgumentParser()
parser.add_argument('--reflections',action='store_true')
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]/('tests/fixtures/reflected-textboxes' if args.reflections else 'tests/fixtures/textbox-pictures')
doc=pdf.PdfDocument(root/'native.pdf');pages=[]
for i,page in enumerate(doc):
 path=root/f'native-{i+1}.png'
 page.render(scale=4).to_pil().convert('RGB').resize((816,1056),Image.Resampling.BOX).save(path)
 pages.append({'name':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
(root/'reference.json').write_text(json.dumps({'referenceVersion':'16.0.20326','sourceSha256':hashlib.sha256((root/'control.docx').read_bytes()).hexdigest(),'pdfSha256':hashlib.sha256((root/'native.pdf').read_bytes()).hexdigest(),'pages':pages},indent=2)+'\n')
