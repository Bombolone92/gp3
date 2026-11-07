"""Record original outline-control observations from private screenshots.

Usage: python tools/record_outline_display.py <private-work-directory>
Screenshots must be captured by the documented native UI protocol first.
This measures rectangular stroke cross-sections, not complete curve fidelity.
"""
from pathlib import Path
from zipfile import ZipFile
from hashlib import sha256
from shutil import copyfile
import json
import math
import sys
from PIL import Image
from pypdf import PdfReader
from pypdf.generic import ContentStream

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/outline-display-width'
WORK = Path(sys.argv[1])
BASE = json.loads((OUT / 'cases.json').read_text())
observations = []
origins = {50: (398, 310), 100: (331, 274), 200: (198, 213)}
frames = [('modern', z) for z in [50, 100, 200]] + [(name, 100) for name in ['rounding', 'phase', 'group-phase', 'group-widths']]


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def cases(name):
    if name == 'modern':
        return [dict(c, xEmu=c['boundsPt'][0]*12700, yEmu=c['boundsPt'][1]*12700) for c in BASE]
    return json.loads((OUT / f'{name}-cases.json').read_text())


sources = {}
for name in sorted(set(name for name, _ in frames)):
    source = OUT / f'{name}.docx'
    native = WORK / f'outline-display-{name}.docx'
    with ZipFile(source) as a, ZipFile(native) as b:
        assert set(a.namelist()) == set(b.namelist()), name
        assert all(a.read(part) == b.read(part) for part in a.namelist()), name
        part_hashes = {part: sha256(a.read(part)).hexdigest() for part in a.namelist()}
    sources[name] = dict(fixtureSha256=digest(source), nativeSourceSha256=digest(native), partsSha256=part_hashes)

for name, zoom in frames:
    source = WORK / f'outline-{name}-screen-{zoom}.png'
    full = Image.open(source).convert('RGB')
    ox, oy = origins[zoom]
    scale = zoom / 100
    width, height = round(200 * 4/3 * scale), round(108 * 4/3 * scale)
    crop_path = OUT / f'native-{name}-{zoom}.png'
    # Analytical page crop: omit application chrome and preserve pixels without resizing.
    full.crop((ox, oy, ox + width, oy + height)).save(crop_path)
    app_path = WORK / 'outline-display-browser' / f'outline-app-{name}-{zoom}.png'
    app = Image.open(app_path).convert('RGB')
    app_copy = OUT / f'app-{name}-{zoom}.png'
    copyfile(app_path, app_copy)
    rows = []
    for c in cases(name):
        # These authored controls contain only opaque neutral-gray outlines on
        # white. A colored mouse-pointer halo can leave the sampled rectangle
        # profile intact while corrupting the surrounding curve reference.
        # Check every shape's full measurement region before accepting a crop.
        x, y = c['xEmu']/9525 * scale, c['yEmu']/9525 * scale
        region = full.crop((ox + math.floor(x) - 4, oy + math.floor(y) - 4,
                            ox + math.ceil(x + 40*scale) + 4,
                            oy + math.ceil(y + 40/3*scale) + 4))
        red, green, blue = region.split()
        assert red.tobytes() == green.tobytes() == blue.tobytes(), (
            name, zoom, c['id'], 'Non-neutral pixels in grayscale control; recapture without pointer overlay')
        if c['shape'] != 'rect':
            continue
        px, py = math.floor(x + 20*scale + .5), math.floor(y + .5)
        native_profile = [full.getpixel((ox + px, oy + py + d))[0] for d in range(-5, 6)]
        app_profile = [app.getpixel((px, py + d))[0] for d in range(-5, 6)]
        # Capture resampling has near-white ringing. The 220 threshold separates
        # opaque C0C0C0 straight-edge pixels from that ringing; it is not a renderer rule.
        dark_rows = [py + d for d, value in zip(range(-5, 6), native_profile) if value < 220]
        left_x, middle_y = math.floor(x + .5), math.floor(y + 10/2 * 4/3 * scale + .5)
        dark_columns = [left_x + d for d in range(-5, 6) if full.getpixel((ox + left_x + d, oy + middle_y))[0] < 220]
        predicted = max(1, math.floor(c['widthEmu']/9525 * scale + .5))
        assert len(dark_rows) == predicted, (name, zoom, c, dark_rows, predicted)
        if name in ['phase', 'group-phase']:
            assert dark_rows == [math.floor(y + .5)]
            assert dark_columns == [math.floor(x + .5)]
        rows.append(dict(id=c['id'], widthEmu=c['widthEmu'], authoredPixelWidth=c['widthEmu']/9525 * scale,
                         nativeDarkRows=dark_rows, nativeDarkColumns=dark_columns,
                         predictedPixelWidth=predicted, nativeRedProfile=native_profile, appRedProfile=app_profile,
                         profileCenter=[px, py], profileOffsets=list(range(-5, 6))))
    observations.append(dict(fixture=name, zoomPercent=zoom, pageOrigin=[ox, oy],
                             originalScreenshotSha256=digest(source), nativeCrop=crop_path.name,
                             nativeCropSha256=digest(crop_path), appCapture=app_copy.name,
                             appCaptureSha256=digest(app_copy), rectangleProfiles=rows))

pdf_path = WORK / 'outline-display-modern-native.pdf'
reader = PdfReader(pdf_path)
pen, stack, pdf_widths = 1, [], []
for args, op in ContentStream(reader.pages[0].get_contents(), reader).operations:
    if op == b'q': stack.append(pen)
    elif op == b'Q': pen = stack.pop()
    elif op == b'w': pen = float(args[0])
    elif op in [b'S', b's']: pdf_widths.append(pen)
assert len(pdf_widths) == 16
copyfile(pdf_path, OUT / 'native-modern.pdf')
record = dict(date='2026-09-30', baseline='832f1f02', referenceVersion='16.0.20326.20158',
              scope='Opaque C0C0C0 axis-aligned rectangle widths and positions; ellipses included visually, not numerically certified.',
              sources=sources, observations=observations, nativePdfSha256=digest(pdf_path), nativePdfStrokeWidthsPt=pdf_widths,
              browserImports=json.loads((WORK / 'outline-display-browser/browser-imports.json').read_text()),
              conclusion='Display widths match max(1, nearest authored pixel width) in these controls; physical PDF widths remain separate. No renderer change or corpus promotion.')
(OUT / 'reference.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(f'Recorded {len(observations)} native/app pairs, {sum(len(o["rectangleProfiles"]) for o in observations)} rectangular cross-sections and 16 PDF pens.')
