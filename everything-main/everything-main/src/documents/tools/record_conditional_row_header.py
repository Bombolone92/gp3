"""Extract reference page membership, repeated labels, colors and baselines."""
from pathlib import Path
from pypdf import PdfReader
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
folder = ROOT / 'tests/fixtures/conditional-row-header'
source = ROOT / 'public/fixtures/conditional-row-header.docx'
pdf = folder / 'native.pdf'
pages = []
for page in PdfReader(pdf).pages:
    state, stack, labels = {'color': '000000'}, [], []
    def operand(op, args, cm, tm):
        if op == b'q': stack.append(dict(state))
        elif op == b'Q': state.update(stack.pop())
        elif op == b'rg': state['color'] = ''.join(f'{round(float(x)*255):02X}' for x in args)
        elif op == b'g': state['color'] = f'{round(float(args[0])*255):02X}' * 3
    def text(value, cm, tm, font, size):
        label = value.strip()
        if re.fullmatch(r'C\dR\dC\d', label):
            labels.append(dict(text=label, color=state['color'], x=tm[4]*cm[0]+tm[5]*cm[2]+cm[4], y=float(page.mediabox.top)-(tm[4]*cm[1]+tm[5]*cm[3]+cm[5])))
    page.extract_text(visitor_operand_before=operand, visitor_text=text)
    assert labels
    pages.append(labels)
    print([(l['text'], l['color']) for l in labels])
result = dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(), pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(), pages=pages)
(folder / 'reference.json').write_text(json.dumps(result, indent=2) + '\n')
