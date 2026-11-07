"""Generate the owned textless source used for native picture-resize captures.

Run after retained_picture_resize_fixture.py. Output must be a fresh path.
Requires lxml (the existing conformance dependency); no reference application or user files.
"""
import argparse
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from lxml import etree


def generate(source, output):
    with ZipFile(source) as archive:
        parts = {name: archive.read(name) for name in archive.namelist()}
    root = etree.fromstring(parts['word/document.xml'])
    for text in list(root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t')):
        text.getparent().remove(text)
    parts['word/document.xml'] = etree.tostring(root, encoding='utf-8')
    with ZipFile(output, 'x') as archive:
        for name, data in parts.items():
            entry = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            archive.writestr(entry, data)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--source', type=Path, default=Path('tests/fixtures/retained-picture-resize/control.docx'))
    args = parser.parse_args()
    generate(args.source, args.output)
