"""Manual XML variants for pointer selection during empty-prompt restoration."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo

root = Path(__file__).resolve().parents[1]
out = root / 'tests/fixtures/empty-control-prompt-pointer'
out.mkdir(exist_ok=True)
with ZipFile(root / 'tests/fixtures/empty-control-home-end/wrapped.docx') as z:
    wrapped = {n: z.read(n) for n in z.namelist()}
with ZipFile(root / 'tests/fixtures/empty-control-home-end/control.docx') as z:
    short = {n: z.read(n) for n in z.namelist()}
tail = b'<w:r><w:t>D</w:t></w:r>'
for name, replacement in [
    ('tail', b'<w:r><w:t>XYZ</w:t></w:r>'),
    ('words', b'<w:r><w:t>XYZ UVW</w:t></w:r>'),
    ('paragraph', b'<w:r><w:t>XYZ UVW</w:t></w:r>'),
    ('runs', b'<w:r><w:t>XYZ</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve"> UVW</w:t></w:r>'),
    ('break', b'<w:r><w:t>XYZ</w:t><w:br/><w:t>UVW</w:t></w:r>'),
    ('soft', b'<w:r><w:t>ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN</w:t></w:r>'),
    ('short', tail),
]:
    parts = dict(short if name == 'short' else wrapped)
    assert parts['word/document.xml'].count(tail) == 1
    parts['word/document.xml'] = parts['word/document.xml'].replace(tail, replacement)
    if name == 'paragraph':
        parts['word/document.xml'] = parts['word/document.xml'].replace(
            b'</w:p><w:sectPr>',
            b'</w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p><w:sectPr>')
    if name == 'soft':
        parts['word/document.xml'] = parts['word/document.xml'].replace(
            b'<w:r><w:t>', b'<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="24"/></w:rPr><w:t>').replace(
            b'w:right="720"', b'w:right="8640"')
    with ZipFile(out / (name + '.docx'), 'w') as z:
        for n, data in parts.items():
            info = ZipInfo(n, (2026, 9, 29, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            z.writestr(info, data)
print('Generated seven independent pointer-restoration inputs')
