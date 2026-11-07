"""Original XML control for dormant complex-script run properties."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

repo = Path(__file__).resolve().parents[1]
root = repo / 'tests/fixtures/complex-script-properties'
root.mkdir(exist_ok=True)
w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
# Reuse only the relationship/content-type skeleton of our original RTL control.
with ZipFile(repo / 'tests/fixtures/rtl-runs/control.docx') as z:
    parts = {name: z.read(name) for name in z.namelist()}
parts['word/styles.xml'] = f'''<w:styles xmlns:w="{w}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Courier New"/><w:sz w:val="20"/><w:szCs w:val="28"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Complex"><w:name w:val="Complex"/><w:basedOn w:val="Normal"/><w:rPr><w:bCs/><w:iCs/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Toggle"><w:name w:val="Toggle"/><w:rPr><w:bCs/><w:iCs w:val="0"/></w:rPr></w:style>
</w:styles>'''.encode()
parts['word/document.xml'] = f'''<w:document xmlns:w="{w}"><w:body>
<w:p><w:r><w:t>Default Latin text</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Complex"/></w:pPr><w:r><w:t>Inherited Latin text</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Complex"/></w:pPr><w:r><w:rPr><w:rStyle w:val="Toggle"/></w:rPr><w:t>Character Latin text</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Complex"/></w:pPr><w:r><w:rPr><w:bCs w:val="0"/><w:iCs w:val="0"/><w:szCs w:val="39"/></w:rPr><w:t>Direct Latin text</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body></w:document>'''.encode()
with ZipFile(root / 'control.docx', 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items():
        z.writestr(name, data)
print(root / 'control.docx')
