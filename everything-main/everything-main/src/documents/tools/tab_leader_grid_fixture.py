"""Original OOXML probes for the tab-leader grid (no document-engine dependency)."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo
import json

ROOT = Path(__file__).resolve().parents[1]
# Reuse only the minimal package scaffold from another original XML fixture.
with ZipFile(ROOT / 'public/fixtures/section-before-spacing.docx') as source:
    scaffold = {name: source.read(name) for name in source.namelist()}

for suffix, margin, kinds in [('', 1440, False), ('-margin', 1510, False), ('-kinds', 1440, True)]:
    rows, cases = [], []
    for font in ['Times New Roman', 'Arial']:
        for index, label in enumerate(['I', 'II', 'III', 'MMMM', 'MMMMI']):
            for indent in [0, 35]:
                leader = ['dot', 'hyphen', 'underscore', 'heavy', 'middleDot'][index] if kinds else 'dot'
                text = 'I' if kinds else label
                cases.append(dict(font=font, text=text, indent=indent, leader=leader, margin=margin))
                rows.append(f'<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="{leader}" w:pos="6000"/></w:tabs><w:ind w:left="{indent}"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="{font}" w:hAnsi="{font}"/></w:rPr><w:t>{text}</w:t><w:tab/><w:t>12</w:t></w:r></w:p>')
    section = f'<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="{margin}" w:header="720" w:footer="720" w:gutter="0"/>'
    parts = dict(scaffold)
    parts['word/document.xml'] = ('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + ''.join(rows) + '<w:sectPr>' + section + '</w:sectPr></w:body></w:document>').encode()
    name = 'tab-leader-grid' + suffix
    with ZipFile(ROOT / 'public/fixtures' / (name + '.docx'), 'w', ZIP_DEFLATED) as target:
        for path, data in parts.items():
            target.writestr(ZipInfo(path, (2026, 9, 18, 0, 0, 0)), data, compress_type=ZIP_DEFLATED)
    references = ROOT / 'tests/fixtures/tab-leader-grid'
    references.mkdir(exist_ok=True)
    (references / (name + '.cases.json')).write_text(json.dumps(cases, indent=2) + '\n')

# Formatting and alignment probes. Superscript intentionally retains evidence
# for the separate, existing font-specific script-transform approximation.
cases = ([dict(id='size' + str(s), size=s) for s in [10, 11, 12, 13, 20]]
    + [dict(id='space' + str(s), space=s) for s in [-10, 20, 40]]
    + [dict(id='scale' + str(s), scale=s) for s in [80, 120]]
    + [dict(id='superscript', script='superscript'), dict(id='bold', bold=True)]
    + [dict(id=a, align=a) for a in ['left', 'center', 'decimal']]
    + [dict(id=a + 'Paragraph', justify=a) for a in ['center', 'right']])
rows = []
for case in cases:
    run = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="' + str(case.get('size', 12) * 2) + '"/>'
    for key, tag in [('space', 'spacing'), ('scale', 'w'), ('script', 'vertAlign')]:
        if key in case:
            run += f'<w:{tag} w:val="{case[key]}"/>'
    if case.get('bold'):
        run += '<w:b/>'
    paragraph = f'<w:tabs><w:tab w:val="{case.get("align", "right")}" w:leader="dot" w:pos="6000"/></w:tabs>'
    if 'justify' in case:
        paragraph += f'<w:jc w:val="{case["justify"]}"/>'
    rows.append(f'<w:p><w:pPr>{paragraph}</w:pPr><w:r><w:rPr>{run}</w:rPr><w:t>I</w:t><w:tab/><w:t>12</w:t></w:r></w:p>')
parts = dict(scaffold)
section = section.replace('w:left="1510" w:header', 'w:left="1440" w:header')
parts['word/document.xml'] = ('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + ''.join(rows) + '<w:sectPr>' + section + '</w:sectPr></w:body></w:document>').encode()
with ZipFile(ROOT / 'public/fixtures/tab-leader-grid-formatting.docx', 'w', ZIP_DEFLATED) as target:
    for path, data in parts.items():
        target.writestr(ZipInfo(path, (2026, 9, 18, 0, 0, 0)), data, compress_type=ZIP_DEFLATED)
(references / 'tab-leader-grid-formatting.cases.json').write_text(json.dumps(cases, indent=2) + '\n')
