"""Compare original reference mask pixels with native GDI+, with/without box prefiltering.

Run on Windows with an output directory. Diagnostic only; not a browser resampler.
"""
from pathlib import Path
from io import BytesIO
from zipfile import ZipFile
from hashlib import sha256
import argparse, base64, json, subprocess
from lxml import etree
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=Path)
parser.add_argument('--fant', action='store_true', help='Compare WIC Fant prefiltering, including fractional controls')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[1]
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)
records = []
controls = ['svg-image-mask-kernel', 'svg-image-mask-phase', 'svg-image-mask-scales']
if args.fant:
    from wic_fant_reference import scale_rgb
    controls.append('svg-image-mask-fractional')
modes = ['direct', 'fant'] if args.fant else ['direct', 'floor', 'round']
for name in controls + ['svg-image-masks-scaled', 'svg-image-masks-step']:
    folder = repo / 'tests/fixtures' / name
    source = folder / 'control.docx' if name in controls else repo / 'public/fixtures' / (name + '.docx')
    reference = json.loads((folder / 'metafile-reference.json').read_text())
    assert sha256(source.read_bytes()).hexdigest() == reference['sourceSha256']
    with ZipFile(source) as package:
        root = etree.fromstring(package.read('word/media/vector.svg'))
    images = root.findall('.//{http://www.w3.org/2000/svg}image')
    # Existing scaled/step fixtures have two vector controls before their PNG.
    selected = list(enumerate(images)) if name in controls else [(2, images[0])]
    for index, element in selected:
        data = base64.b64decode(element.get('href').split(',', 1)[1])
        image = Image.open(BytesIO(data)).convert('RGB')
        factor = image.width / 16
        assert image.height / 60 == factor
        block = 1
        while factor / block >= 4:
            block *= 2
        native_entry = reference['images'][index]
        native_path = folder / native_entry['path']
        assert sha256(native_path.read_bytes()).hexdigest() == native_entry['sha256']
        for mode in modes:
            processed = image
            if mode == 'fant' and block > 1:
                input_path = out / f'{name}-{index}-source.png'
                image.save(input_path)
                processed = scale_rgb(input_path, (image.width + block - 1) // block, (image.height + block - 1) // block)
            elif mode in ['floor', 'round']:
                assert image.width % block == 0 and image.height % block == 0
                processed = Image.new('RGB', (image.width // block, image.height // block))
                area = block * block
                for y in range(processed.height):
                    for x in range(processed.width):
                        pixels = [image.getpixel((x * block + dx, y * block + dy)) for dy in range(block) for dx in range(block)]
                        processed.putpixel((x, y), tuple((sum(p[c] for p in pixels) + (area // 2 if mode == 'round' else 0)) // area for c in range(3)))
            prefix = f'{name}-{index}-{mode}'
            processed.save(out / (prefix + '-input.png'))
            records.append(dict(fixture=name, case=index, mode=mode, prefix=prefix, factor=factor, block=block if mode != 'direct' else 1,
                                sourceSha256=reference['sourceSha256'], nativeSha256=native_entry['sha256'],
                                nativePath=str(native_path)))
subprocess.run(['pwsh.exe', '-NoProfile', '-File', str(repo / 'tools/diagnose-gdi-prefilter.ps1'), '-InputFolder', str(out)], check=True)
for record in records:
    native = Image.open(record.pop('nativePath')).getchannel('A').crop((1, 1, 17, 61))
    actual_path = out / (record.pop('prefix') + '-output.png')
    actual = Image.open(actual_path).getchannel('R')
    errors = [abs(a - b) for a, b in zip(native.getdata(), actual.getdata())]
    record.update(maxError=max(errors), totalError=sum(errors), changedPixels=sum(e != 0 for e in errors), outputSha256=sha256(actual_path.read_bytes()).hexdigest())
(out / 'comparison.json').write_text(json.dumps(records, indent=2) + '\n')
for mode in modes:
    rows = [r for r in records if r['mode'] == mode]
    print(mode, 'exact', sum(r['changedPixels'] == 0 for r in rows), '/', len(rows), 'total error', sum(r['totalError'] for r in rows))
if args.fant and any(r['changedPixels'] for r in records if r['mode'] == 'fant'):
    raise SystemExit(1)
