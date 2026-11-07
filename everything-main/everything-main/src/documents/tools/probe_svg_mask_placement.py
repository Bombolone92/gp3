"""Unreleased fractional-placement diagnostic; exits 1 on native differences."""
from pathlib import Path
from zipfile import ZipFile
from io import BytesIO
from hashlib import sha256
import argparse
import base64
import json
import numpy as np
from lxml import etree
from PIL import Image
from probe_svg_mask_cubic import accumulated_weights

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=Path)
parser.add_argument('--phase-x', type=float, default=0)
parser.add_argument('--phase-y', type=float, default=0)
parser.add_argument('--reflect-x', action='store_true', help='Diagnostic reflection around the nearest integer; not a renderer correction')
parser.add_argument('--preserve-half-x', action='store_true', help='With --reflect-x, retain exact half-pixel origins as a separate hypothesis')
parser.add_argument('--sweep', action='store_true')
args = parser.parse_args()
if args.preserve_half_x and not args.reflect_x:
    parser.error('--preserve-half-x requires --reflect-x')
folder = Path(__file__).resolve().parents[1] / 'tests/fixtures' / ('svg-image-mask-placement-sweep' if args.sweep else 'svg-image-mask-placement')
reference = json.loads((folder / 'metafile-reference.json').read_text())
source = folder / 'control.docx'
assert sha256(source.read_bytes()).hexdigest() == reference['sourceSha256']
assert sha256((folder / 'cases.json').read_bytes()).hexdigest() == reference['casesSha256']
with ZipFile(source) as package:
    svg = etree.fromstring(package.read('word/media/vector.svg'))
results = []
for i, (case, element) in enumerate(zip(json.loads((folder / 'cases.json').read_text()), svg.findall('.//{http://www.w3.org/2000/svg}image'), strict=True)):
    image = np.array(Image.open(BytesIO(base64.b64decode(element.get('href').split(',', 1)[1]))).convert('RGB'))
    assert np.array_equal(image[:, :, 0], image[:, :, 1]) and np.array_equal(image[:, :, 0], image[:, :, 2])
    origin_x = 2 * round(case['x']) - case['x'] if args.reflect_x else case['x']
    if args.preserve_half_x and float(case['x'] * 2).is_integer():
        origin_x = case['x']
    x = accumulated_weights(image.shape[1], 16, case['width'], origin_x + args.phase_x)
    y = accumulated_weights(image.shape[0], 60, case['height'], case['y'] + args.phase_y)
    horizontal = np.floor(np.clip(image[:, :, 0] @ x.T, 0, 255) + .5)
    actual = np.floor(np.clip(y @ horizontal, 0, 255) + .5)
    entry = reference['images'][i]
    native = folder / entry['path']
    assert sha256(native.read_bytes()).hexdigest() == entry['sha256']
    expected = np.array(Image.open(native).getchannel('A'))[1:61, 1:17]
    error = np.abs(actual - expected)
    results.append(dict(case=case['name'], changedPixels=int(np.count_nonzero(error)), maxError=int(error.max()),
                        totalError=int(error.sum()), sourceSha256=reference['sourceSha256'], nativeSha256=entry['sha256']))
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(dict(phase=[args.phase_x, args.phase_y], reflectX=args.reflect_x, preserveHalfX=args.preserve_half_x, results=results), indent=2) + '\n')
print(json.dumps(results, indent=2))
raise SystemExit(1 if any(row['changedPixels'] for row in results) else 0)
