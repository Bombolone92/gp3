"""Original Arabic/Hebrew formatting boundaries, with no corpus content."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
import json

repo = Path(__file__).resolve().parents[1]
root = repo / 'tests/fixtures/bidi-decorations'
root.mkdir(exist_ok=True)
with ZipFile(repo / 'tests/fixtures/bidi-layout/control.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
cases = []
body = []
for text, split in [('لا', 1), ('سلام', 2), ('مرحبا', 1), ('אבגד', 2)]:
    for mode in ['color', 'underline', 'highlight', 'strike']:
        i = len(cases)
        cases.append(dict(index=i, text=text, split=split, mode=mode))
        page = '<w:pageBreakBefore/>' if i and i % 6 == 0 else ''
        body.append(f'<w:p><w:pPr>{page}<w:spacing w:before="0" w:after="0" w:line="300" w:lineRule="exact"/></w:pPr><w:r><w:t>Case {i+1}: {mode}</w:t></w:r></w:p>')
        runs = []
        for j, segment in enumerate([text[:split], text[split:]]):
            props = '<w:rtl/><w:sz w:val="40"/><w:szCs w:val="40"/>'
            if mode == 'color': props += f'<w:color w:val="{["FF0000", "0000FF"][j]}"/>'
            elif j == 0 and mode == 'underline': props += '<w:u w:val="single" w:color="FF0000"/>'
            elif j == 0 and mode == 'highlight': props += '<w:highlight w:val="yellow"/>'
            elif j == 0 and mode == 'strike': props += '<w:strike/>'
            runs.append(f'<w:r><w:rPr>{props}</w:rPr><w:t>{escape(segment)}</w:t></w:r>')
        body.append('<w:p><w:pPr><w:spacing w:before="0" w:after="240" w:line="720" w:lineRule="exact"/></w:pPr>' + ''.join(runs) + '</w:p>')
body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>')
parts['word/document.xml'] = f'<w:document xmlns:w="{w}"><w:body>{"".join(body)}</w:body></w:document>'.encode()
with ZipFile(root / 'control.docx', 'w', ZIP_DEFLATED) as z:
    for n, data in parts.items(): z.writestr(n, data)
(root / 'cases.json').write_text(json.dumps(cases, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print(root / 'control.docx')
