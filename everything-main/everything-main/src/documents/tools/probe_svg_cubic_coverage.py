"""Compare unreleased cubic flattening candidates with the larger reference controls."""
from pathlib import Path
from hashlib import sha256
import argparse
import json
import numpy as np
from PIL import Image
from probe_svg_cubic_flatten import subdivide, finite_difference, quantized_input


def polygon_coverage(points, origin, width, height):
    """Single closed polygon, nonzero winding, half-open 8x4 sample grid."""
    counts = np.zeros((height, width), dtype=int)
    for row in range(height):
        for sy in range(4):
            y = origin[1]+row+sy/4
            events = []
            for a, b in zip(points, np.roll(points, -1, axis=0)):
                if a[1] <= y < b[1]:
                    events.append((a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]), 1))
                elif b[1] <= y < a[1]:
                    events.append((a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]), -1))
            events.sort()
            winding, start = 0, None
            for x, change in events:
                previous = winding
                winding += change
                if previous == 0 and winding != 0:
                    start = x
                elif previous != 0 and winding == 0:
                    left = max(0, int(np.ceil((start-origin[0])*8)))
                    right = min(width*8, int(np.ceil((x-origin[0])*8)))
                    if right <= left:
                        continue
                    first, last = left//8, (right-1)//8
                    if first == last:
                        counts[row, first] += right-left
                    else:
                        counts[row, first] += 8-left % 8
                        counts[row, last] += (right-1) % 8+1
                        counts[row, first+1:last] += 8
    return np.floor(counts*255/32+.5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/svg-cubic-coverage-large'
    ref = json.loads((folder/'metafile-reference.json').read_text())
    geometry = json.loads((folder/'native-coverage-reference.json').read_text())
    for name, key in [('control.docx', 'sourceSha256'), ('cases.json', 'casesSha256')]:
        assert sha256((folder/name).read_bytes()).hexdigest() == ref[key] == geometry[key]
    cases = json.loads((folder/'cases.json').read_text())
    results = []
    for case, entry, row in zip(cases, ref['images'], geometry['rows'], strict=True):
        path = folder/entry['path']
        assert sha256(path.read_bytes()).hexdigest() == entry['sha256'] == row['nativeSha256']
        with Image.open(path) as image:
            native = np.array(image.getchannel('A')).astype(float)
        data = row['flattened'][0]
        models = {'native-flattened': np.array(data['coordinates']).reshape(-1, 2),
                  'subdivide': subdivide(quantized_input(case['points'])),
                  'finite-difference-14': finite_difference(quantized_input(case['points']))}
        for name, points in models.items():
            actual = polygon_coverage(points, entry['transform'][4:], native.shape[1], native.shape[0])
            error = abs(actual-native)
            result = dict(case=case['name'], model=name, changedPixels=int(np.count_nonzero(error)),
                          maxError=int(error.max()), totalError=int(error.sum()))
            results.append(result)
            print(result)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, indent=2)+'\n')
    return 1 if any(row['changedPixels'] for row in results) else 0


if __name__ == '__main__':
    raise SystemExit(main())
