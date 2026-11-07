"""Author a bounded optional-ligature caret control using original OOXML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import sys
from xml.sax.saxutils import escape

repo = Path(__file__).resolve().parents[1]
destination = Path(sys.argv[1])
destination.mkdir(parents=True, exist_ok=True)
# Reuse only the repository's authored minimal package shell.
with ZipFile(repo / 'tests/fixtures/kerned-caret-boundaries/control.docx') as package:
    parts = {name: package.read(name) for name in package.namelist()}
paragraphs = []
for family in ['Source Sans Pro', 'Source Sans Pro Light']:
    for kerning in [0, 2]:
        paragraphs.append(f'''<w:p><w:pPr><w:spacing w:after="240" w:line="240" w:lineRule="auto"/></w:pPr>
<w:r><w:rPr><w:rFonts w:ascii="{escape(family)}" w:hAnsi="{escape(family)}"/>
<w:sz w:val="36"/><w:kern w:val="{kerning}"/><w14:ligatures w14:val="standardContextual"/>
</w:rPr><w:t>office ffi fi fl AVATAR To Wa</w:t></w:r></w:p>''')
parts['word/document.xml'] = ('''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
 xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14"><w:body>'''
 + ''.join(paragraphs) + '''<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>
<w:pgMar w:top="720" w:bottom="720" w:left="720" w:right="720" w:header="360" w:footer="360" w:gutter="0"/>
</w:sectPr></w:body></w:document>''').encode()
with ZipFile(destination / 'control.docx', 'w', ZIP_DEFLATED) as package:
    for name, data in parts.items():
        package.writestr(name, data)
