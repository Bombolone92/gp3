"""Author a minimal inline rich-text navigation fixture directly as OOXML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/inline-control-navigation'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
OUT.mkdir(exist_ok=True)
with ZipFile(ROOT / 'tests/fixtures/empty-inline-controls/control.docx') as source:
    base = {name: source.read(name) for name in source.namelist()}
for name, prompt in [('inline', ''), ('placeholder', '<w:showingPlcHdr/>')]:
    parts = dict(base)
    parts['word/document.xml'] = (f'<?xml version="1.0" encoding="UTF-8"?>'
        f'<w:document xmlns:w="{W}"><w:body><w:p>'
        '<w:r><w:t>A</w:t></w:r><w:sdt><w:sdtPr><w:alias w:val="letters"/>'
        '<w:tag w:val="letters"/><w:id w:val="810"/>' + prompt + '<w:richText/>'
        '</w:sdtPr><w:sdtEndPr/><w:sdtContent><w:r><w:t>BC</w:t></w:r>'
        '</w:sdtContent></w:sdt><w:r><w:t>D</w:t></w:r></w:p>'
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>'
        '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" '
        'w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
        '</w:body></w:document>').encode()
    with ZipFile(OUT / f'{name}.docx', 'w', ZIP_DEFLATED) as package:
        for part, data in parts.items():
            package.writestr(part, data)
