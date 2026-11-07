"""Independently check the edited row-geometry DOCX, using OPC/XML only."""
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
import argparse
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS = {'w': W}
EXPORTS = {'row-geometry.docx': ('row-oversized-headers-15-probe.docx', 'exact-prior0-header24 line 000', 8), 'row-merged-later-14-edited.docx': ('row-merged-later-14-probe.docx', 'Right second', 1), 'row-merged-exact-oversized-14-edited.docx': ('row-merged-exact-oversized-14-probe.docx', 'Right second', 1), 'row-merged-exact-oversized-15-edited.docx': ('row-merged-exact-oversized-15-probe.docx', 'Right second', 1), 'row-merged-exact-later-14-edited.docx': ('row-merged-exact-later-14-probe.docx', 'Right second', 1), 'row-merged-exact-later-15-edited.docx': ('row-merged-exact-later-15-probe.docx', 'Right second', 1)}


def canonical(node):
    return ET.canonicalize(ET.tostring(node, encoding='unicode'))


def check_export(path):
    source_name, label, table_count = EXPORTS[path.name]
    source_path = ROOT / 'public/fixtures/row-geometry' / source_name
    with ZipFile(source_path) as source, ZipFile(path) as output:
        assert set(source.namelist()) == set(output.namelist()), 'Package parts changed'
        for name in source.namelist():
            if name != 'word/document.xml':
                assert source.read(name) == output.read(name), name
        before = ET.fromstring(source.read('word/document.xml'))
        after = ET.fromstring(output.read('word/document.xml'))
    first, second = before.findall('.//w:p', NS), after.findall('.//w:p', NS)
    assert len(first) == len(second), 'Paragraph structure changed'
    text = lambda paragraph: ''.join(node.text or '' for node in paragraph.findall('.//w:t', NS))
    changes = 0
    for original, edited in zip(first, second):
        if text(original) == label:
            changes += 1
            assert text(edited) == label + 'X', 'Expected body-cell text edit missing'
            a, b = original.find('w:pPr', NS), edited.find('w:pPr', NS)
            assert canonical(a) == canonical(b), 'Edited paragraph layout changed'
        else:
            assert canonical(original) == canonical(edited), text(original)
    assert changes == 1, 'Probe label is not unique'
    for property_name in ['tblPr', 'tblGrid', 'trPr', 'tcPr', 'sectPr']:
        assert [canonical(node) for node in before.findall(f'.//w:{property_name}', NS)] == [
            canonical(node) for node in after.findall(f'.//w:{property_name}', NS)
        ], f'{property_name} changed'
    assert len(after.findall('.//w:tbl', NS)) == table_count
    print('PASS independent row geometry declarations, cell edit, other paragraphs and package parts:', path)


def check_fixtures():
    manifest = json.loads((ROOT / 'tests/fixtures/row-geometry/provenance.json').read_text(encoding='utf-8'))
    for fixture in manifest['fixtures']:
        with ZipFile(ROOT / 'public/fixtures/row-geometry' / fixture['fixture']) as archive:
            assert set(archive.namelist()) == set(fixture['canonicalPartSha256'])
            for name, expected in fixture['canonicalPartSha256'].items():
                actual = hashlib.sha256(ET.canonicalize(archive.read(name).decode('utf-8')).encode('utf-8')).hexdigest()
                assert actual == expected, (fixture['fixture'], name)
        print('PASS reference probe source provenance:', fixture['fixture'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('paths', nargs='*', type=Path)
    parser.add_argument('--check-fixtures', action='store_true')
    parser.add_argument('--check-exports', action='store_true')
    args = parser.parse_args()
    if args.check_fixtures: check_fixtures()
    paths = args.paths
    if args.check_exports:
        for name in EXPORTS:
            matches = list((ROOT / 'test-results').rglob(name))
            assert matches, f'Missing browser row-geometry export: {name}'
            paths += matches
    for path in paths: check_export(path)
