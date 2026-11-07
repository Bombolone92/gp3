"""Original explicit font references for a reviewed open font."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(root / 'public/fixtures/table-shading-scope.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}

def paragraph(text, size, family, line='auto'):
    font = f'<w:rFonts w:ascii="{family}" w:hAnsi="{family}"/><w:sz w:val="{size * 2}"/>'
    spacing = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>' if line == 'auto' else '<w:spacing w:before="0" w:after="0" w:line="720" w:lineRule="exact"/>'
    return f'<w:p><w:pPr>{spacing}<w:rPr>{font}</w:rPr></w:pPr><w:r><w:rPr>{font}</w:rPr><w:t xml:space="preserve">{text}</w:t></w:r></w:p>'

body = paragraph('ORIGINAL OPEN FONT', 36, 'Bebas Neue')
body += paragraph('ALPHA BETA GAMMA DELTA EPSILON ZETA ETA THETA IOTA KAPPA LAMBDA MU. ' * 3, 18, 'Bebas Neue')
body += paragraph('EXACT LINE HEADING', 24, 'Bebas Neue', 'exact')
body += paragraph('Body text uses installed Arial.', 12, 'Arial')
body += '<w:sectPr><w:pgSz w:w="7200" w:h="8640"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()
with ZipFile(root / 'public/fixtures/reviewed-font.docx', 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items():
        z.writestr(name, data)
