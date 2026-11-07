"""Independent alternate drawing stories with different editing metadata."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import re
import sys
import tempfile
import drawing_text_alternates_fixture as base


def generate(destination):
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='drawing-text-metadata-') as directory:
        base.generate(Path(directory))
        with ZipFile(Path(directory) / 'control.docx') as archive:
            parts = {name: archive.read(name) for name in archive.namelist()}
    document = parts['word/document.xml'].decode('utf-8')
    branch = 0

    def replace(match):
        nonlocal branch
        text = match[0]
        session = '00112233' if branch == 0 else '44556677'
        end = '' if branch == 0 else '<w:sdtEndPr/>'
        text = text.replace('<w:p>', f'<w:p w:rsidRDefault="{session}">', 1)
        text = re.sub(r'(<w:r>[\s\S]*?</w:r>)',
                      r'<w:sdt><w:sdtPr><w:id w:val="501"/><w:richText/></w:sdtPr>'
                      + end + r'<w:sdtContent>\1</w:sdtContent></w:sdt>', text, count=1)
        branch += 1
        return text

    # Only the single shape's two alternate stories differ. Group neighbors
    # retain the base control's independent paragraphs and formatting.
    document = re.sub(r'<w:txbxContent>[\s\S]*?</w:txbxContent>', replace, document, count=2)
    parts['word/document.xml'] = document.encode('utf-8')
    with ZipFile(destination / 'control.docx', 'w', ZIP_DEFLATED) as archive:
        for name, data in parts.items():
            archive.writestr(name, data)
    print(destination / 'control.docx')


if __name__ == '__main__':
    generate(Path(sys.argv[1]) if len(sys.argv) > 1 else
             Path(__file__).resolve().parents[1] / 'tests/fixtures/drawing-text-metadata')
