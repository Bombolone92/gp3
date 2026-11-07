"""Record marker observations from independently captured reference PDFs."""
from pathlib import Path
import hashlib,json,argparse
import pypdfium2 as pdf
from PIL import Image

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--reference-build',required=True)
 args=parser.parse_args()
 p=Path(__file__).resolve().parents[1]/'tests/fixtures/numbering-override-index'
 cases=json.loads((p/'cases.json').read_text())
 refs=[]
 for name in ['control','matched','matched-identified']:
  f=pdf.PdfDocument(str(p/(name+'-native.pdf')))
  assert len(f)==1
  text=f[0].get_textpage().get_text_range();rows=[]
  for case in cases:
   lines=[line.strip() for line in text.splitlines() if line.strip().endswith(case['label'])]
   assert len(lines)==1,(name,case,lines)
   rows.append({**case,'marker':lines[0][:-len(case['label'])].strip()})
  f[0].render(scale=4).to_pil().convert('RGB').resize((816,1056),Image.Resampling.BOX).save(p/(name+'-native.png'))
  sha=lambda suffix:hashlib.sha256((p/(name+suffix)).read_bytes()).hexdigest()
  refs.append({'name':name,'referenceBuild':args.reference_build,'sourceSha256':sha('.docx'),'pdfSha256':sha('-native.pdf'),'pngSha256':sha('-native.png'),'rows':rows})
 (p/'reference.json').write_text(json.dumps(refs,indent=2)+'\n',encoding='utf-8')
if __name__=='__main__':main()
