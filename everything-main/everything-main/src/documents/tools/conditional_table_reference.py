"""Extract observed cell text color/font from the independent reference PDF export."""
import json
import hashlib
from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdfium
from canvas_conditional_table_fixture import CASES, REGIONS

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/conditional-table-styles'
pages = PdfReader(folder / 'native.pdf').pages
rendered = pdfium.PdfDocument(folder / 'native.pdf')
assert len(pages) == len(CASES)
result = {}
for case, page in zip(CASES, pages):
    pixels = rendered[CASES.index(case)].render(scale=2).to_pil()
    state = {'color': '000000'}
    stack = []
    cells = {}
    def operand(op, args, cm, tm):
        if op == b'q': stack.append(dict(state))
        elif op == b'Q': state.update(stack.pop())
        elif op == b'rg': state['color'] = ''.join(f'{round(float(x)*255):02X}' for x in args)
        elif op == b'g': state['color'] = f'{round(float(args[0])*255):02X}' * 3
    def text(value, cm, tm, font, size):
        value = value.strip()
        if len(value) == 4 and value[0] == 'R' and value[2] == 'C':
            cells[value] = {'color': state['color'], 'font': str(font.get('/BaseFont')), 'size': size,
                            'x': round(tm[4]*cm[0]+tm[5]*cm[2]+cm[4], 3),
                            'y': round(float(page.mediabox.top)-(tm[4]*cm[1]+tm[5]*cm[3]+cm[5]), 3)}
    page.extract_text(visitor_operand_before=operand, visitor_text=text)
    assert len(cells) == (24 if case == 'merged' else 25), (case, cells)
    for cell in cells.values():
        cell['fill'] = ''.join(f'{v:02X}' for v in pixels.getpixel((round((cell['x']+65)*2), round((cell['y']-4)*2)))[:3])
    result[case] = cells
    names = {color: name for name, color in REGIONS.items()}
    print(case)
    for r in range(5): print(' | '.join(names.get(cells.get(f'R{r}C{c}', {}).get('color'), cells.get(f'R{r}C{c}', {}).get('color', 'merged')) for c in range(5)))
    if case == 'derived': print('derived first-row fills:', [cells[f'R0C{c}']['fill'] for c in range(5)])
(folder / 'reference.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
paths = [root / 'public/fixtures/conditional-table-styles.docx', folder / 'native.pdf']
(folder / 'manifest.json').write_text(json.dumps({str(p.relative_to(root)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}, indent=2)+'\n', encoding='utf-8')
