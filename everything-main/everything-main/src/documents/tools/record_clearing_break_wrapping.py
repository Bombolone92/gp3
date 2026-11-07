"""Record hash-bound native GDI text/frame coordinates for authored controls."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
from record_manual_break_wrapping import page_reference

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/clearing-break-wrapping'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def record(capture_root, scope):
    metadata = json.loads((capture_root/'page-capture.json').read_text(encoding='utf-8-sig'))
    assert metadata['sourceUnchanged'] and metadata['savedBefore'] and metadata['savedAfter']
    assert sha((ROOT/f'{scope}.docx').read_bytes()) == metadata['sourceSha256']
    pages = []
    for index, binding in enumerate(metadata['captures']):
        assert binding['page'] == index+1 and binding['widthPt'] == 612 and binding['heightPt'] == 792
        data = (capture_root/binding['file']).read_bytes()
        assert sha(data) == binding['sha256'] and len(data) == binding['length']
        native = page_reference(data)
        name = f'{scope}-page-{index+1}.emf.gz'
        (ROOT/name).write_bytes(gzip.compress(data, mtime=0))
        pages.append(dict(page=index, file=name, sha256=sha(data), **native))
    result = dict(sourceSha256=metadata['sourceSha256'], referenceBuild=metadata['referenceBuild'],
                  sourceUnchanged=True, savedBefore=True, savedAfter=True, readOnly=metadata['readOnly'],
                  tolerancePt=.2, pages=pages)
    (ROOT/f'{scope}-native.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(dict(scope=scope, pages=len(pages), lines=sum(len(p['lines']) for p in pages))))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture_root', type=Path)
    parser.add_argument('--scope', default='body')
    args = parser.parse_args()
    record(args.capture_root, args.scope)
