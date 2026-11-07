"""Retain unmasked native first-frame crops after leaving the active table."""
from pathlib import Path
from PIL import Image
import numpy as np
import hashlib, json, sys

work = Path(sys.argv[1])
folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/border-phase'
sha = lambda data: hashlib.sha256(data).hexdigest()
observations = []
for name, zoom, origin, capture_name, metadata_name, reference_name in [
    ('control', 125, [224, 200], 'native-125.jpg', 'control-metadata.json', 'native-intermediate-reference.json'),
    ('filled', 150, [176, 205], 'native-filled-150.jpg', 'filled-metadata.json', 'native-fill-reference.json'),
]:
    reference = json.loads((folder / reference_name).read_bytes())
    rows = next(c for c in reference['controls'] if c['source'] == name + '.docx')['observations'] if 'controls' in reference else reference['observations']
    previous = next(o for o in rows if o['zoom'] == zoom)
    metadata = json.loads((work / metadata_name).read_text(encoding='utf-8-sig'))
    assert metadata['savedBefore'] and metadata['savedAfter'] and metadata['sourceUnchanged'] and metadata['characters'] == ''
    assert metadata['sourceSha256'] == sha((folder / (name + '.docx')).read_bytes())
    region = previous['regions'][0]
    x, y, w, h = region
    capture = Image.open(work / capture_name)
    assert capture.format == 'JPEG' and capture.size == (946, 536)
    ox, oy = origin
    assert ox+x+w <= capture.width and oy+y+h <= capture.height
    crop = capture.crop((ox+x, oy+y, ox+x+w, oy+y+h)).convert('RGB')
    output = folder / f'native-clean-{name}-{zoom}-first.png'
    crop.save(output)
    old_path = folder / previous['crop']
    assert sha(old_path.read_bytes()) == previous['cropSha256']
    old = np.array(Image.open(old_path).convert('RGB'))[y:y+h, x:x+w]
    new = np.array(crop)
    black = lambda a: a.max(axis=2) < 128
    changes = [dict(x=int(x+dx), y=int(y+dy), previousBlack=bool(black(old)[dy,dx]), cleanBlack=bool(black(new)[dy,dx])) for dy,dx in np.argwhere(black(old) != black(new))]
    observations.append(dict(source=name+'.docx', zoom=zoom, sourceSha256=metadata['sourceSha256'], referenceBuild=metadata['referenceBuild'], sourceUnchanged=True,
                             origin=origin, region=region, captureSha256=sha((work/capture_name).read_bytes()), crop=output.name, cropSha256=sha(output.read_bytes()),
                             previousCrop=previous['crop'], previousCropSha256=previous['cropSha256'], blackMaskChanges=changes))
result = dict(scope='First frame only; Ctrl+End leaves the active table, then the pointer is moved outside the paper. Original captures are retained. No pixels masked or retouched.', observations=observations)
(folder/'native-clean-corners-reference.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
