"""Independently verify original continuation fixtures and browser DOCX edits."""
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile
import argparse
import json
import xml.etree.ElementTree as ET
from continuation_border_fixtures import generate, fixtures, Q
from continuation_heading_fixtures import generate as generate_headings, fixtures as heading_fixtures
from continuation_exact_fixtures import generate as generate_exact, fixtures as exact_fixtures

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / 'public/fixtures/continuation-borders'
EXPORTS = {
    'continuation-long-merged-all': 'Merge 70',
    'continuation-long-merged-continuation': 'Merge 70',
    'continuation-long-merged-owner': 'Merge 70',
    'continuation-structure-header-16-0': 'Inner B30',
    'continuation-small-exact-20-96-0-zero': 'Inner A1',
    'continuation-small-exact-20-96-96': 'Inner A1',
    'continuation-small-exact-page-20-oversized': 'Inner A2',
}

def parts(path):
    with ZipFile(path) as archive:
        return {name: archive.read(name) for name in archive.namelist()}

def canonical(value):
    if isinstance(value, ET.Element): value = ET.tostring(value, encoding='unicode')
    if isinstance(value, bytes): value = value.decode('utf-8')
    return ET.canonicalize(value, rewrite_prefixes=True)

def check_fixtures():
    names = set(fixtures())
    references = json.loads((ROOT / 'tests/fixtures/continuation-borders/native-lines.json').read_text())
    assert set(references) == names
    headings = set(heading_fixtures())
    heading_refs = json.loads((ROOT / 'tests/fixtures/continuation-borders/native-heading-pages.json').read_text())
    assert set(heading_refs) == {name + '-native.pdf' for name in headings}
    check_generated(SOURCES, names, generate)
    check_generated(ROOT / 'public/fixtures/continuation-headings', headings, generate_headings)
    exact = set(exact_fixtures())
    exact_refs = json.loads((ROOT / 'tests/fixtures/continuation-borders/native-small-exact.json').read_text())
    assert set(exact_refs) == exact
    check_generated(ROOT / 'public/fixtures/continuation-exact', exact, generate_exact)

def check_generated(folder, names, generator):
    assert {path.stem for path in folder.glob('*.docx')} == names
    with TemporaryDirectory(prefix='continuation-provenance-') as temporary:
        generated = Path(temporary)
        generator(generated)
        for name in sorted(names):
            source, regenerated = parts(folder / f'{name}.docx'), parts(generated / f'{name}.docx')
            assert source.keys() == regenerated.keys(), name
            for part in source:
                assert canonical(source[part]) == canonical(regenerated[part]), (name, part)
            print('PASS original XML provenance:', name)

def check_export(path, name):
    folder = ROOT / 'public/fixtures/continuation-exact' if name.startswith('continuation-small-exact-') else SOURCES
    source, edited = parts(folder / f'{name}.docx'), parts(path)
    assert source.keys() == edited.keys(), path
    for part in source:
        if part != 'word/document.xml': assert source[part] == edited[part], (path, part)
    before, after = ET.fromstring(source['word/document.xml']), ET.fromstring(edited['word/document.xml'])
    text = lambda p: ''.join(item.text or '' for item in p.iter(Q + 't'))
    original = before.findall('.//' + Q + 'p')
    changed = after.findall('.//' + Q + 'p')
    assert len(original) == len(changed), path
    label = EXPORTS[name]
    assert sum(text(p) == label for p in original) == 1, name
    for a, b in zip(original, changed):
        if text(a) != label:
            assert canonical(a) == canonical(b), (path, text(a))
            continue
        assert text(b) == label + 'X', (path, text(b))
        assert canonical(a.find(Q + 'pPr')) == canonical(b.find(Q + 'pPr')), path
        formatting = canonical(a.find(Q + 'r').find(Q + 'rPr'))
        for run in b.findall(Q + 'r'):
            assert canonical(run.find(Q + 'rPr')) == formatting, (path, 'typing format')
    for tag in ['tblPr', 'tblGrid', 'trPr', 'tcPr', 'sectPr']:
        assert [canonical(e) for e in before.iter(Q + tag)] == [canonical(e) for e in after.iter(Q + tag)], (path, tag)
    assert len(before.findall('.//' + Q + 'tr')) == len(after.findall('.//' + Q + 'tr')), path
    assert len(before.findall('.//' + Q + 'tc')) == len(after.findall('.//' + Q + 'tc')), path
    print('PASS text edit, formatting, table structure and untouched package parts:', path)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-fixtures', action='store_true')
    parser.add_argument('--check-exports', action='store_true')
    parser.add_argument('--exports-dir', type=Path, default=ROOT / 'test-results')
    args = parser.parse_args()
    if args.check_fixtures: check_fixtures()
    if args.check_exports:
        for name in EXPORTS:
            matches = list(args.exports_dir.rglob(name + '-edited.docx'))
            assert matches, 'Missing browser export: ' + name
            for path in matches: check_export(path, name)
