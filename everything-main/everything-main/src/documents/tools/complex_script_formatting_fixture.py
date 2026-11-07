"""Original controls for forced complex-script font and italic rendering."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

repo = Path(__file__).resolve().parents[1]
root = repo / 'tests/fixtures/complex-script-formatting'
root.mkdir(exist_ok=True)
w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(repo / 'tests/fixtures/rtl-runs/control.docx') as z:
    parts = {name: z.read(name) for name in z.namelist()}
cases, body = [], []
for family in ['Arial', 'Courier New', 'Times New Roman']:
    for flag in ['cs', 'rtl']:
        for mode in ['plain', 'italic', 'bold-italic']:
            i = len(cases)
            cases.append(dict(index=i, page=i//6, family=family, flag=flag, mode=mode, text='ABC 012 ٠'))
            br = '<w:pageBreakBefore/>' if i and i % 6 == 0 else ''
            body.append(f'<w:p><w:pPr>{br}<w:spacing w:before="0" w:after="120"/></w:pPr><w:r><w:t>Case {i+1}: {family} {flag} {mode}</w:t></w:r></w:p>')
            bold = '<w:bCs/>' if mode == 'bold-italic' else '<w:bCs w:val="0"/>'
            italic = '<w:iCs/>' if mode != 'plain' else '<w:iCs w:val="0"/>'
            props = f'<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="{family}"/>{bold}{italic}<w:sz w:val="20"/><w:szCs w:val="32"/><w:{flag}/>'
            body.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="360" w:line="480" w:lineRule="exact"/></w:pPr><w:r><w:rPr>{props}</w:rPr><w:t>ABC 012 ٠</w:t></w:r></w:p>')
body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>')
parts['word/document.xml'] = f'<w:document xmlns:w="{w}"><w:body>{"".join(body)}</w:body></w:document>'.encode()
with ZipFile(root / 'control.docx', 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items():
        z.writestr(name, data)
(root/'cases.json').write_text(json.dumps(cases, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(root/'control.docx')
