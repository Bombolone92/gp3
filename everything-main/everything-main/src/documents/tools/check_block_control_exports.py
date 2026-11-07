"""Independent OPC/XML checks for the block control browser probes."""
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET

BASE = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS = {'w': W}

def text(root):
    return ''.join(node.text or '' for node in root.findall('.//w:t', NS))

paths = sorted((BASE / 'test-results').glob('block-controls-*/block-*.docx'))
expected_names = {f'block-{location}-{edit}.docx' for location in ['body', 'cell', 'table', 'nested', 'mixed'] for edit in ['formatted', 'edited']}
expected_names.update({'block-table-row.docx', 'block-cellonly-row.docx'})
assert {path.name for path in paths} == expected_names, 'Missing or unexpected block-control browser exports'
for path in paths:
    _, location, edit = path.stem.split('-')
    with ZipFile(BASE / 'public' / 'fixtures' / f'block-control-{location}.docx') as source, ZipFile(path) as saved:
        assert set(source.namelist()) == set(saved.namelist())
        for name in source.namelist():
            if name != 'word/document.xml':
                assert source.read(name) == saved.read(name), (path, name)
        original = ET.fromstring(source.read('word/document.xml'))
        result = ET.fromstring(saved.read('word/document.xml'))
    expected = text(original)
    ids = [node.get(f'{{{W}}}val') for node in result.findall('.//w:sdt/w:sdtPr/w:id', NS)]
    if edit == 'formatted':
        assert ids == (['41', '42'] if location in ['nested', 'mixed'] else ['41']), (path, ids)
        first = result.find('.//w:sdt/w:sdtContent/w:p/w:r', NS)
        assert first.find('w:rPr/w:b', NS) is not None, path
        assert text(first) == 'Control', path
    elif edit == 'row':
        assert ids == (['41'] if location == 'cellonly' else []), (path, ids)
        rows = result.findall('.//w:tr', NS)
        assert len(rows) == 2, path
        assert text(rows[1]) == '', path
        assert rows[1].find('.//w:sdt', NS) is None, path
    else:
        expected = expected.replace('Control alpha', 'CoXntrol alpha')
        assert ids == (['42'] if location in ['nested', 'mixed'] else []), (path, ids)
    assert text(result) == expected, path
    print('PASS independent wrapper lifetime, text, formatting and package preservation:', path.name)

