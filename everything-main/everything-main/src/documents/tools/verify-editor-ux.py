"""Independent assertions for browser exports from editor-ux.spec.js."""
import argparse
from pathlib import Path
from zipfile import ZipFile
from lxml import etree

parser = argparse.ArgumentParser()
parser.add_argument('--fonts', type=Path)
parser.add_argument('--quick-actions', type=Path)
args = parser.parse_args()
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
ns = {'w': W}

def read(path):
    with ZipFile(path) as package:
        return {name: package.read(name) for name in package.namelist()}

if args.fonts:
    original = read(Path(__file__).resolve().parents[1] / 'public/fixtures/editor-ux.docx')
    saved = read(args.fonts)
    assert saved.keys() == original.keys()
    for name, data in original.items():
        if name != 'word/document.xml':
            assert saved[name] == data, name
    root = etree.fromstring(saved['word/document.xml'])
    run = root.xpath('//w:r[w:t="Choose this font éΩ"]', namespaces=ns)[0]
    fonts = run.find('w:rPr/w:rFonts', ns)
    for key in ('ascii', 'hAnsi'):
        assert fonts.get(f'{{{W}}}{key}') == 'Oswald'
        assert fonts.get(f'{{{W}}}{key}Theme') is None
    for key in ('eastAsia', 'cs'):
        assert fonts.get(f'{{{W}}}{key}') == 'Noto Sans'
    print('Font declarations and unrelated package parts verified:', args.fonts)

if args.quick_actions:
    saved = read(args.quick_actions)
    root = etree.fromstring(saved['word/document.xml'])
    paragraph = root.xpath('//w:p[.//w:t="A shaded paragraph"]', namespaces=ns)[0]
    assert paragraph.find('w:pPr/w:shd', ns).get(f'{{{W}}}fill') == 'DDEEFF'
    assert paragraph.find('w:pPr/w:spacing', ns).get(f'{{{W}}}line') == '360'
    table = root.find('.//w:tbl', ns)
    assert len(table.findall('w:tr', ns)) == 2
    assert all(len(row.findall('w:tc', ns)) == 3 for row in table.findall('w:tr', ns))
    assert b'https://example.com/guide' in saved['word/_rels/document.xml.rels']
    print('Paragraph fill, spacing, hyperlink and table dimensions verified:', args.quick_actions)
