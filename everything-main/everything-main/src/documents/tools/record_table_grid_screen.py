"""Measure opaque horizontal bands in a native screenshot; never fit registration."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('capture', type=Path)
    p.add_argument('source', type=Path)
    p.add_argument('cases', type=Path)
    p.add_argument('output', type=Path, help='Reference JSON; PNG uses matching -screen stem')
    p.add_argument('--page-origin', type=int, nargs=2, required=True)
    p.add_argument('--crop', type=int, nargs=4, required=True, metavar=('X', 'Y', 'W', 'H'))
    p.add_argument('--sample-x', type=int, nargs=3, required=True, help='Paper-relative positions away from junctions')
    p.add_argument('--zoom', type=int, required=True)
    args = p.parse_args()
    image = Image.open(args.capture).convert('RGB')
    x, y, w, h = args.crop
    ox, oy = args.page_origin
    if not (0 <= x < x+w <= image.width and 0 <= y < y+h <= image.height):
        p.error('Crop lies outside the capture')
    tables = []
    for i, sample in enumerate(args.sample_x, 1):
        sx = ox + sample
        if not x + 3 <= sx < x+w-3:
            p.error('Interior sampling window lies outside crop')
        bands = []
        for yy in range(y, y+h):
            if all(max(image.getpixel((xx, yy))) < 128 for xx in range(sx-3, sx+4)):
                row = yy-oy
                if bands and bands[-1][1] == row:
                    bands[-1][1] += 1
                else:
                    bands.append([row, row+1])
        if len(bands) != 7:
            p.error(f'Table {i}: expected seven separate row rules, found {len(bands)}')
        tables.append({'id': i, 'sampleX': sample, 'bands': bands})
    crop_path = args.output.with_name(args.output.stem.replace('-reference', '-screen')+'.png')
    image.crop((x, y, x+w, y+h)).save(crop_path)
    report = {
        'sourceSha256': sha(args.source), 'casesSha256': sha(args.cases),
        'nativeCaptureSha256': sha(args.capture), 'nativeCropSha256': sha(crop_path),
        'pageOrigin': [ox, oy], 'nativeCropOrigin': [x, y],
        'zoomPercent': args.zoom, 'deviceScaleFactor': 1, 'captureFormat': Image.open(args.capture).format,
        'scope': 'Fixed paper-edge registration; opaque horizontal bands sampled away from junctions. JPEG is not an exact coverage oracle or whole-page fidelity proof.',
        'tables': tables,
    }
    args.output.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'rules': sum(len(t['bands']) for t in tables), 'cropSha256': report['nativeCropSha256']}))


if __name__ == '__main__':
    main()
