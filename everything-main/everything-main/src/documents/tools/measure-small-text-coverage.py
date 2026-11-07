"""Measure white ink in the 12 small-text control cells at 288 DPI.

Usage: python tools/measure-small-text-coverage.py WORD.png CANVAS.png OUTLINE.png
This is a coverage diagnostic, not a pixel-alignment or conformance test.
"""
import hashlib
import json
import sys
from pathlib import Path
from PIL import Image


def measure(path):
    image = Image.open(path).convert('RGB')
    if image.size != (2448, 3168):
        raise ValueError('Expected a full Letter page at 288 DPI')
    background = (85, 130, 107)
    rows = []
    for y in range(image.height):
        if image.getpixel((2000, y)) == background:
            if not rows or y > rows[-1][-1] + 1:
                rows.append([])
            rows[-1].append(y)
    rows = [row for row in rows if len(row) > 30]
    if len(rows) != 6:
        raise ValueError('Expected six green sample rows')
    samples = []
    for index, row in enumerate(rows):
        for bold, x in enumerate((288, 1225)):
            box = (x, row[0] + 4, x + 530, row[-1] - 3)
            pixels = image.crop(box).getdata()
            coverage = sum(max(0, (p[0] - background[0]) / (255 - background[0])) for p in pixels)
            samples.append({'family': 'Book Antiqua' if index < 3 else 'Arial',
                            'points': (7, 10, 14)[index % 3], 'bold': bool(bold),
                            'crop': box, 'whiteCoveragePixels': round(coverage, 3)})
    return {'sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(), 'samples': samples}


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    results = {name: measure(path) for name, path in zip(('word', 'canvas', 'outline'), sys.argv[1:])}
    for name in ('canvas', 'outline'):
        for sample, native in zip(results[name]['samples'], results['word']['samples']):
            sample['coverageErrorPercent'] = round(100 * (sample['whiteCoveragePixels'] / native['whiteCoveragePixels'] - 1), 4)
    print(json.dumps(results, indent=2))
