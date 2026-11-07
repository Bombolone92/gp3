"""Bind sequence/ancestor-reset controls to already captured native reference PDFs."""
from pathlib import Path
import argparse,hashlib,json
import pypdfium2 as pdf
from PIL import Image

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--reference-build',required=True);args=parser.parse_args()
 root=Path(__file__).resolve().parents[1]/'tests/fixtures/numbering-override-sequences'
 for source,cases,pdfname,pngprefix,reference in [('control.docx','cases.json','native.pdf','native','reference.json'),('nested.docx','nested-cases.json','nested-native.pdf','nested-native','nested-reference.json')]:
  document=pdf.PdfDocument(str(root/pdfname));text='\n'.join(document[i].get_textpage().get_text_range() for i in range(len(document)))
  rows=json.loads((root/cases).read_text())
  for row in rows:
   matches=[line.strip() for line in text.splitlines() if line.strip().endswith(row['label'])]
   assert len(matches)==1,(row,matches)
   row['marker']=matches[0][:-len(row['label'])].strip()
  images=[]
  for i in range(len(document)):
   name=f'{pngprefix}-{i+1}.png';images.append(name)
   document[i].render(scale=4).to_pil().convert('RGB').resize((816,1056),Image.Resampling.BOX).save(root/name)
  sha=lambda name:hashlib.sha256((root/name).read_bytes()).hexdigest()
  result={'referenceBuild':args.reference_build,'sourceSha256':sha(source),'pdfSha256':sha(pdfname),'pngSha256':[sha(name) for name in images],'rows':rows}
  (root/reference).write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
if __name__=='__main__':main()
