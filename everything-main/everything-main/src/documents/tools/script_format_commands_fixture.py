"""Original independent OOXML controls for native Bold/Italic commands."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
import json
repo = Path(__file__).resolve().parents[1]
root = repo / 'tests/fixtures/script-format-commands'
root.mkdir(exist_ok=True)
with ZipFile(repo / 'tests/fixtures/rtl-runs/control.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
cases = []
body = []
for text, flag in [('Latin', ''), ('Latin', 'cs'), ('Latin', 'rtl'), ('אבגד', ''), ('אבגד', 'rtl'), ('سلام', ''), ('سلام', 'rtl'), ('1234', 'rtl'), ('٠١٢٣', 'rtl')]:
    for ordinary, complex in [(0,0),(0,1),(1,0),(1,1)]:
        cases.append(dict(text=text, flag=flag, ordinary=ordinary, complex=complex))
        props = f'<w:b w:val="{ordinary}"/><w:bCs w:val="{complex}"/><w:i w:val="{ordinary}"/><w:iCs w:val="{complex}"/><w:sz w:val="20"/><w:szCs w:val="32"/>'
        if flag: props += f'<w:{flag}/>'
        body.append(f'<w:p><w:r><w:rPr>{props}</w:rPr><w:t>{escape(text)}</w:t></w:r></w:p>')
for pairs in [[(0,0),(1,0)],[(0,0),(0,1)],[(0,0),(1,1)],[(0,1),(1,0)],[(1,1),(0,0)],[(1,0),(0,1)],[(1,1),(1,0)]]:
    cases.append(dict(text='LeftRight', flag='', pairs=pairs))
    runs = []
    for text, (ordinary, complex) in zip(['Left','Right'],pairs):
        props = f'<w:b w:val="{ordinary}"/><w:bCs w:val="{complex}"/><w:i w:val="{ordinary}"/><w:iCs w:val="{complex}"/><w:sz w:val="20"/><w:szCs w:val="32"/>'
        runs.append(f'<w:r><w:rPr>{props}</w:rPr><w:t>{text}</w:t></w:r>')
    body.append('<w:p>'+''.join(runs)+'</w:p>')
parts['word/styles.xml'] = f'<w:styles xmlns:w="{w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>'.encode()
parts['word/document.xml'] = f'<w:document xmlns:w="{w}"><w:body>{"".join(body)}<w:sectPr/></w:body></w:document>'.encode()
with ZipFile(root / 'control.docx', 'w', ZIP_DEFLATED) as z:
    for n, data in parts.items(): z.writestr(n, data)
(root / 'cases.json').write_text(json.dumps(cases, ensure_ascii=False, indent=2), encoding='utf-8')
