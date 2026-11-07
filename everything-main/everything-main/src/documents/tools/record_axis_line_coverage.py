"""Bind dark cores and half-gray coverage to independently captured native pixels.

No image registration is fitted. The fixed paper edge and crop origins come
from the capture observation. JPEG threshold bounds are not alpha oracles.
"""
from pathlib import Path
from hashlib import sha256
import argparse
import json
import math
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def record(folder, image, reference, crop_name, zoom):
    dx = reference['pageOrigin'][0] - reference['nativeCropOrigin'][0]
    dy = reference['pageOrigin'][1] - reference['nativeCropOrigin'][1]
    cases = []
    for source in reference['cases']:
        region = [math.floor(v*zoom+.5) for v in source['region']]
        l, t, r, b = region
        dark = []
        gray = []
        for y in range(t, b):
            for x in range(l, r):
                rgb = image.getpixel((x+dx, y+dy))
                if max(rgb) < 96:
                    dark.append((x, y))
                if source['cap'] == 'flat' and 96 <= min(rgb) and max(rgb) <= 192:
                    gray.append([x, y, *rgb])
        if not dark:
            raise ValueError(f'No dark core: {source["id"]}')
        xs, ys = zip(*dark)
        cases.append({'id': source['id'], 'region': region,
                      'darkBounds': [min(xs), min(ys), max(xs)+1, max(ys)+1],
                      'grayPixels': gray})
    report = {
        'sourceSha256': digest(folder/'control.docx'),
        'casesSha256': digest(folder/'cases.json'),
        'nativeCaptureSha256': reference['nativeCaptureSha256'],
        'nativeCropSha256': digest(folder/crop_name), 'nativeCrop': crop_name,
        'pageOrigin': reference['pageOrigin'], 'nativeCropOrigin': reference['nativeCropOrigin'],
        'zoom': zoom, 'darkThreshold': 96, 'grayMaximumChannelDifference': 32,
        'scope': 'Exact dark-core bounds plus bounded half-gray coverage checks. JPEG is not an exact alpha/coverage oracle; threshold-128 diagnostics remain unchanged.',
        'cases': cases,
    }
    target = folder/('native-coverage-reference.json' if zoom == 1 else 'native-coverage-reference-75.json')
    target.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(f'{folder.name} zoom {zoom}: {len(cases)} cores, {sum(len(c["grayPixels"]) for c in cases)} gray pixels')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--capture75', type=Path)
    args = p.parse_args()
    for name in ['axis-line-display', 'axis-line-display-pens']:
        folder = ROOT/'tests/fixtures'/name
        ref = json.loads((folder/'native-screen-reference.json').read_bytes())
        record(folder, Image.open(folder/'native-screen-atlas.png').convert('RGB'), ref, 'native-screen-atlas.png', 1)
    if args.capture75:
        folder = ROOT/'tests/fixtures/axis-line-display-pens'
        ref = json.loads((folder/'native-screen-reference.json').read_bytes())
        # Independently observed leading paper outline pixels, not first white
        # interior pixels. 75% white begins at X=326, outline/paper origin X=325.
        ref['pageOrigin'] = [325, 91]
        ref['nativeCropOrigin'] = [358, 112]
        ref['nativeCaptureSha256'] = digest(args.capture75)
        image = Image.open(args.capture75).convert('RGB')
        crop = image.crop((358, 112, 902, 531))
        crop_name = 'native-screen-atlas-75.png'
        crop.save(folder/crop_name)
        record(folder, crop, ref, crop_name, .75)


if __name__ == '__main__':
    main()
