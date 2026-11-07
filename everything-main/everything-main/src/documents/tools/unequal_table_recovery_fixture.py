from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/unequal-table-recovery'
OUT.mkdir(parents=True, exist_ok=True)
# This base is an independently authored OPC package, not renderer output.
with ZipFile(ROOT / 'tests/fixtures/image-recovery/healthy.docx') as z:
    base = {n: z.read(n) for n in z.namelist()}
for variant in ['first', 'second', 'split']:
    for unequal in [False, True]:
        parts = dict(base)
        xml = parts['word/document.xml'].decode().replace('w:w="5000"', 'w:w="1800"')
        if variant == 'second':
            xml = xml.replace('<w:tbl>', '<w:p><w:r><w:br w:type="column"/></w:r></w:p><w:tbl>', 1)
        if variant == 'split':
            a, b = xml.index('<w:tr>'), xml.index('</w:tr>') + len('</w:tr>')
            row = xml[a:b]
            xml = xml[:a] + ''.join(row.replace('Retained table cell', f'Cell {i:02d}') for i in range(90)) + xml[b:]
        width = 4860 if unequal else 2500
        cols = f'<w:cols w:num="2" w:equalWidth="0" w:sep="1"><w:col w:w="2500" w:space="720"/><w:col w:w="{width}"/></w:cols>'
        xml = xml.replace('</w:sectPr>', cols + '</w:sectPr>')
        parts['word/document.xml'] = xml.encode()
        name = ('unequal-' if unequal else 'equal-') + variant
        with ZipFile(OUT / (name + '.docx'), 'w', ZIP_DEFLATED) as z:
            for n, data in parts.items(): z.writestr(n, data)
