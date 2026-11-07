"""Bind authored cubic controls to native flattening and reference alpha evidence.

First extract vector.svg from the control DOCX. For each index 0..5, run
diagnose-svg-cubic-path.ps1 with the authored SVG Width/Height, PathIndex=index and
OutputFolder=<captures>/<index>. This records native reference data only.
"""
from pathlib import Path
from hashlib import sha256
import argparse
import base64
import json
import numpy as np
from zipfile import ZipFile
from xml.etree import ElementTree
import zlib
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('captures', type=Path)
parser.add_argument('fixture', type=Path)
parser.add_argument('--compressed-alpha', action='store_true', help='Compress larger native alpha references with zlib')
args = parser.parse_args()
ref = json.loads((args.fixture / 'metafile-reference.json').read_text())
for name, key in [('control.docx', 'sourceSha256'), ('cases.json', 'casesSha256')]:
    assert sha256((args.fixture / name).read_bytes()).hexdigest() == ref[key]
with ZipFile(args.fixture / 'control.docx') as package:
    svg = ElementTree.fromstring(package.read('word/media/vector.svg'))
    shape = (int(svg.get('height')), int(svg.get('width')))
rows = []
for i, entry in enumerate(ref['images']):
    word_path = args.fixture / entry['path']
    assert sha256(word_path.read_bytes()).hexdigest() == entry['sha256']
    with Image.open(word_path) as image:
        word = np.array(image.getchannel('A')).astype(int)
    capture = args.captures / str(i)
    native_path = capture / 'native-path-Half.png'
    with Image.open(native_path) as image:
        native = np.array(image.getchannel('A')).astype(int)
    assert native.shape == shape
    a, b, c, d, x, y = entry['transform']
    assert [a, b, c, d] == [1, 0, 0, 1] and int(x) == x and int(y) == y
    x, y = int(x), int(y)
    h, w = word.shape
    delta = abs(native[y:y+h, x:x+w] - word)
    flattened = json.loads((capture / 'flattened-paths.json').read_text(encoding='utf-8-sig'))
    alpha = word.astype(np.uint8).tobytes()
    alpha_record = {'alphaDeflateBase64': base64.b64encode(zlib.compress(alpha)).decode()} if args.compressed_alpha else {'alphaBase64': base64.b64encode(alpha).decode()}
    rows.append(dict(case=i, nativeSha256=sha256(native_path.read_bytes()).hexdigest(),
                     **alpha_record,
                     nativeSha256=entry['sha256'], changedPixels=int(np.count_nonzero(delta)),
                     maxError=int(delta.max()), totalError=int(delta.sum()), flattened=flattened))
result = dict(sourceSha256=ref['sourceSha256'], casesSha256=ref['casesSha256'],
              referenceBuild=ref['referenceBuild'], rows=rows)
(args.fixture / 'native-coverage-reference.json').write_text(json.dumps(result, indent=2) + '\n')
exact = sum(row['changedPixels'] == 0 for row in rows)
print(f'{exact}/{len(rows)} native paths match reference alpha exactly')
raise SystemExit(0 if exact == len(rows) else 1)
