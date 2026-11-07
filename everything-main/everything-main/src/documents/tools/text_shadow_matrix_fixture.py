"""Generate original shadow controls from declared cases, independently of layout."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
import json
import re

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/text-shadow-line-metrics'
cases = json.loads((folder / 'cases.json').read_text())
with ZipFile(folder / 'control.docx') as source:
    package = {name: source.read(name) for name in source.namelist()}
w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
for name, records in cases.items():
    paragraphs = []
    for index, case in enumerate(records):
        props = f'<w:rFonts w:ascii="{case["face"]}" w:hAnsi="{case["face"]}"/>'
        props += ('<w:b/>' if case.get('bold') else '') + ('<w:i/>' if case.get('italic') else '')
        props += f'<w:sz w:val="{int(case["size"] * 2)}"/>'
        effect = f'<w14:shadow w14:blurRad="{int(case.get("blur", 0) * 12700)}" w14:dist="{int(case["dist"] * 12700)}" w14:dir="{int(case["direction"] * 60000)}" w14:sx="100000" w14:sy="100000" w14:kx="0" w14:ky="0" w14:algn="ctr"><w14:srgbClr w14:val="888888"/></w14:shadow>'
        for key, value in case.get('attrs', {}).items():
            effect = re.sub(f'w14:{key}="[^"]*"', f'w14:{key}="{value}"', effect)
        for key in case.get('omit', []):
            effect = re.sub(f' w14:{key}="[^"]*"', '', effect)
        if 'alpha' in case:
            effect = effect.replace('<w14:srgbClr w14:val="888888"/>', f'<w14:srgbClr w14:val="888888"><w14:alpha w14:val="{case["alpha"]}"/></w14:srgbClr>')
        mark = props + (effect if case.get('mode', 'both') in ['both', 'mark'] else '')
        run = props + (effect if case.get('mode', 'both') in ['both', 'run'] else '')
        page_break = '<w:pageBreakBefore/>' if index else ''
        lines = '<w:br/>'.join(f'<w:t xml:space="preserve">{escape(case.get("text", "Sample line"))}</w:t>' for _ in range(3))
        paragraphs.append(f'<w:p><w:pPr>{page_break}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:rPr>{mark}</w:rPr></w:pPr><w:r><w:rPr>{run}</w:rPr>{lines}</w:r></w:p>')
        props = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/>'
        paragraphs.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:rPr>{props}</w:rPr></w:pPr><w:r><w:rPr>{props}</w:rPr><w:t>After</w:t></w:r></w:p>')
    body = ''.join(paragraphs) + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
    document = f'<w:document xmlns:w="{w}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14"><w:body>{body}</w:body></w:document>'
    with ZipFile(folder / f'{name}.docx', 'w', ZIP_DEFLATED) as output:
        for part, data in package.items():
            output.writestr(part, document if part == 'word/document.xml' else data)
