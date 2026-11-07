"""Record high-resolution ink from an independently exported reference PDF."""
import argparse
import hashlib
import json
import math
from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdfium

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('pdf', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--reference-version', required=True)
args = parser.parse_args()
reader = PdfReader(args.pdf)
assert len(reader.pages) == 1, 'Expected the eight-style, one-page control'
page = reader.pages[0]
lines = []
def visit(text, cm, tm, font, size):
    if text.strip():
        lines.append(dict(text=text.strip(), x=tm[4]*cm[0]+tm[5]*cm[2]+cm[4],
                          baseline=float(page.mediabox.height)-(tm[4]*cm[1]+tm[5]*cm[3]+cm[5]),
                          size=float(size)))
page.extract_text(visitor_text=visit)
assert len(lines) == 16, 'Unexpected native text spans'
lines = [line for line in lines if line['text'].startswith('Measured typography')]
assert len(lines) == 8
scale = 16/3
pdf = pdfium.PdfDocument(args.pdf)
image = pdf[0].render(scale=scale).to_pil().convert('RGB')
for line in lines:
    box = [math.floor(32*scale), math.floor((line['baseline']-line['size']*.9)*scale),
           math.ceil(605*scale), math.ceil((line['baseline']+line['size']*.3)*scale)]
    line['box'] = box
    line['ink'] = sum(1-sum(pixel)/765 for pixel in image.crop(box).getdata())
result = dict(sourceSha256=hashlib.sha256(args.source.read_bytes()).hexdigest(),
              pdfSha256=hashlib.sha256(args.pdf.read_bytes()).hexdigest(),
              word=args.reference_version, dpi=384, lines=lines)
args.output.write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
pdf.close()
