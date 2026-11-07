"""Original alternate text frames with branch-owned placeholder references."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
import re
import tempfile
import drawing_text_alternates_fixture as base


def generate(destination):
    with tempfile.TemporaryDirectory(prefix='drawing-placeholder-refs-') as directory:
        base.generate(Path(directory))
        with ZipFile(Path(directory) / 'control.docx') as archive:
            parts = {name: archive.read(name) for name in archive.namelist()}
    destination.mkdir(parents=True, exist_ok=True)
    for temporary in (True, False):
        branch = 0

        def wrap(match):
            nonlocal branch
            reference = ['ModernPrompt', 'LegacyPrompt'][branch]
            properties = ('<w:id w:val="501"/><w:placeholder><w:docPart '
                          f'w:val="{reference}"/></w:placeholder>'
                          + ('<w:temporary/>' if temporary else '')
                          + '<w:showingPlcHdr/><w:richText/>')
            story = re.sub(r'(<w:r>[\s\S]*?</w:r>)',
                           '<w:sdt><w:sdtPr>' + properties + '</w:sdtPr>'
                           + r'<w:sdtContent>\1</w:sdtContent></w:sdt>', match[0], count=1)
            branch += 1
            return story

        document = re.sub(r'<w:txbxContent>[\s\S]*?</w:txbxContent>', wrap,
                          parts['word/document.xml'].decode(), count=2)
        own = {**parts, 'word/document.xml': document.encode()}
        with ZipFile(destination / ('temporary.docx' if temporary else 'persistent.docx'), 'w', ZIP_DEFLATED) as archive:
            for name, data in own.items():
                info = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
                info.compress_type = ZIP_DEFLATED
                archive.writestr(info, data)


if __name__ == '__main__':
    generate(Path(__file__).resolve().parents[1] / 'tests/fixtures/drawing-placeholder-refs')
