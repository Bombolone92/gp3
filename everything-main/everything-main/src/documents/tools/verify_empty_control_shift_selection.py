"""Check hash-bound native evidence for unresolved extended-control selection."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/empty-control-shift-selection'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

def verify():
    ref = json.loads((ROOT / 'reference.json').read_text())
    assert ref['referenceBuild'] == '16.0.20326' and ref['zoomPercent'] == 500
    for case in ref['cases']:
        for kind in ('source', 'result'):
            data = (ROOT / case[kind]).read_bytes()
            assert hashlib.sha256(data).hexdigest() == case[kind + 'Sha256']
        with ZipFile(ROOT / case['source']) as z:
            source = E.fromstring(z.read('word/document.xml'))
        assert ''.join(source.find(W + 'body').itertext()) == 'AD'
        assert len(list(source.iter(W + 'sdt'))) == 1
        assert ''.join(next(source.iter(W + 'sdtContent')).itertext()) == ''
        with ZipFile(ROOT / case['result']) as z:
            result = E.fromstring(z.read('word/document.xml'))
        text = '\n'.join(''.join(p.itertext()) for p in result.find(W + 'body').findall(W + 'p'))
        controls = [dict(text=''.join(c.find(W + 'sdtContent').itertext()), placeholder=c.find(W + 'sdtPr/' + W + 'showingPlcHdr') is not None) for c in result.iter(W + 'sdt')]
        assert text == case['text'] and controls == case['controls'], case['name']
    return len(ref['cases'])

if __name__ == '__main__':
    print(f'Verified {verify()} native Shift-selection references')
