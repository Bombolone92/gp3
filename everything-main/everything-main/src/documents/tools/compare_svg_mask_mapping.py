"""Compare native mapping diagnostics with hash-bound authored reference controls.

Capture each fixture/mapping subfolder with diagnose-svg-mask-placement.ps1.
This tool evaluates native diagnostics only; it is not used by the renderer.
"""
from pathlib import Path
from hashlib import sha256
import argparse
import json
import numpy as np
from PIL import Image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('captures', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    rows = []
    for family in ['svg-image-mask-placement', 'svg-image-mask-placement-sweep']:
        folder = repo / 'tests/fixtures' / family
        reference = json.loads((folder / 'metafile-reference.json').read_text())
        for filename, key in [('control.docx', 'sourceSha256'), ('cases.json', 'casesSha256')]:
            assert sha256((folder / filename).read_bytes()).hexdigest() == reference[key]
        for mapping in ['points', 'explicit-transform', 'rectangle-transform']:
            captures = args.captures / family / mapping
            records = json.loads((captures / 'mapping.json').read_text(encoding='utf-8-sig'))
            for i, (entry, record) in enumerate(zip(reference['images'], records, strict=True)):
                assert record['case'] == i and record['mapping'] == mapping
                path = folder / entry['path']
                assert sha256(path.read_bytes()).hexdigest() == entry['sha256']
                with Image.open(path) as image:
                    word = np.array(image.getchannel('A'))[1:61, 1:17].astype(int)
                capture = captures / f'{i}.png'
                with Image.open(capture) as image:
                    rgba = np.array(image.convert('RGBA'))
                assert rgba.shape == (60, 16, 4)
                assert np.all(rgba[:, :, 3] == 255)
                assert np.array_equal(rgba[:, :, 0], rgba[:, :, 1])
                assert np.array_equal(rgba[:, :, 0], rgba[:, :, 2])
                delta = abs(word - rgba[:, :, 0].astype(int))
                rows.append(dict(fixture=family, case=i, mapping=mapping,
                                 transform=record['transform'],
                                 changedPixels=int(np.count_nonzero(delta)),
                                 maxError=int(delta.max()), totalError=int(delta.sum()),
                                 sourceSha256=reference['sourceSha256'],
                                 nativeSha256=entry['sha256'],
                                 captureSha256=sha256(capture.read_bytes()).hexdigest()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(rows, indent=2) + '\n')
    exact = sum(row['changedPixels'] == 0 for row in rows)
    print(f'{exact}/{len(rows)} native mapping captures match the native reference exactly')
    return 0 if exact == len(rows) else 1


if __name__ == '__main__':
    raise SystemExit(main())
