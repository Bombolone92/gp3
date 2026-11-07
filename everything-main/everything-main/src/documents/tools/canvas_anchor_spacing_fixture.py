"""Independent anchored-picture spacing probe, extending the authored anchors."""
from zipfile import ZipFile, ZIP_DEFLATED
from canvas_anchor_position_fixture import make, ROOT

parts = make(15)
# Positive spacing inherited by all runs; a nearer negative value on anchors.
parts['word/styles.xml'] = parts['word/styles.xml'].replace('<w:sz ', '<w:spacing w:val="40"/><w:sz ', 1)
pieces = parts['word/document.xml'].split('<w:r><w:drawing>')
parts['word/document.xml'] = pieces[0] + ''.join(
    ('<w:r><w:rPr><w:spacing w:val="-20"/></w:rPr><w:drawing>' if i % 2 else '<w:r><w:drawing>') + part
    for i, part in enumerate(pieces[1:]))
if __name__ == '__main__':
    with ZipFile(ROOT / 'public/fixtures/anchor-spacing.docx', 'w', ZIP_DEFLATED) as archive:
        for name, data in parts.items(): archive.writestr(name, data)
