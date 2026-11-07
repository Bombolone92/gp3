"""Record the independently captured reference screen edge; retain the PDF oracle."""
import hashlib
import json
import sys
from pathlib import Path
from PIL import Image
import numpy as np

root = Path(__file__).resolve().parents[1] / 'tests/fixtures/shape-display-resolution'
capture = Path(sys.argv[1])
opened = Path(sys.argv[2])
source = (root / 'control.docx').read_bytes()
assert opened.read_bytes() == source, 'The reference application must open the exact independent control'
image = Image.open(capture)
assert image.format == 'JPEG' and image.size == (1280, 752)
# Recorded at 400% native zoom, with the left margin at screen x=24: the half-inch
# margin is 192 device pixels, so the page origin is -168. The vertical edge
# at page x=384 is sampled away from its top join and the mouse pointer.
crop_box = (211, 670, 222, 700)
crop = image.crop(crop_box)
rgb = np.asarray(crop.convert('RGB'))
median = np.median(rgb[:, :, 0], axis=0)
assert np.max(rgb.max(axis=2).astype(int)-rgb.min(axis=2)) <= 2
ink = np.where(median < 128, 255, 0).tolist()
assert ink == [0, 0, 0, 0, 255, 255, 255, 0, 0, 0, 0]
crop.save(root / 'native-screen-400-strip.png')
report = dict(sourceSha256=hashlib.sha256(source).hexdigest(),
    captureSha256=hashlib.sha256(capture.read_bytes()).hexdigest(),
    cropSha256=hashlib.sha256((root/'native-screen-400-strip.png').read_bytes()).hexdigest(),
    captureFormat=image.format, zoomPercent=400, deviceScaleFactor=1,
    crop=crop_box, pageOriginX=-168, profilePageX=379,
    ink=ink, medianRed=median.tolist(),
    scope='Opaque axis-aligned left edge only. Threshold 128 extracts footprint from JPEG; not an opacity oracle. Screen zoom 400% at DPR1 compared with browser 100% at DPR4.')
(root/'native-screen-reference.json').write_text(json.dumps(report,indent=2)+'\n')
print('Recorded native three-pixel screen footprint; physical PDF profiles remain unchanged.')
