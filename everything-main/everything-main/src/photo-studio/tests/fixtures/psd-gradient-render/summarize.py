"""Verify regenerated descriptors and summarize compatible-editor pixels.

python summarize.py /tmp/gradient-probes /tmp/gradient-reference report.json
This records observations; it is not a rendering test of any application.
"""
from pathlib import Path
import hashlib
import json
import sys
from PIL import Image
from psd_tools import PSDImage
from psd_tools.constants import Tag
from psd_tools.psd.descriptor import Descriptor, List, Enumerated, UnitFloat

source, capture, output = map(Path, sys.argv[1:4])


def compare(a, b, where):
    if isinstance(a, Descriptor):
        assert a.classID == b.classID and set(a) == set(b), where
        for key in a:
            compare(a[key], b[key], (where, key))
    elif isinstance(a, List):
        assert len(a) == len(b), where
        for i, (left, right) in enumerate(zip(a, b)):
            compare(left, right, (where, i))
    elif isinstance(a, Enumerated):
        assert type(a) is type(b) and a.typeID == b.typeID and a.enum == b.enum, where
    else:
        assert type(a) is type(b) and a.value == b.value, where
        if isinstance(a, UnitFloat):
            assert a.unit == b.unit, where


report = json.loads((capture / "capture.json").read_text())
assert report["files"], "No reference captures"
report["scope"] = "Compatible-editor observations, not validation against other applications"
report["observations"] = []
for name in report["files"]:
    original = PSDImage.open(source / name)
    edited = PSDImage.open(capture / (name + ".reference.psd"))
    assert original.size == edited.size and len(original) == len(edited) == 1, name
    # Verify the saved caches themselves; a constructor's initial canvas color
    # does not establish what was actually written to the PSD.
    for cached in [original.topil(), original[0].topil()]:
        assert cached is not None, name
        assert cached.convert("RGBA").getextrema() == (
            (255, 255), (0, 0), (255, 255), (255, 255)
        ), name
    before = original[0].tagged_blocks.get_data(Tag.GRADIENT_FILL_SETTING)
    after = edited[0].tagged_blocks.get_data(Tag.GRADIENT_FILL_SETTING)
    compare(before, after, name)
    image = Image.open(capture / (name + ".png")).convert("RGBA")
    assert image.size == original.size, name
    pixels = list(getattr(image, "get_flattened_data", image.getdata)())
    # The source caches are solid magenta. A varying gray field proves
    # that the reference regenerated the definition rather than exporting one
    # of those deliberately stale caches.
    assert len(set(pixels)) > 2, name
    assert all(r == g == b and a == 255 for r, g, b, a in pixels), name
    row = [r for r, _, _, _ in pixels[:image.width]]
    assert all(pixels[y * image.width:(y + 1) * image.width] == pixels[:image.width]
               for y in range(image.height)), name
    report["observations"].append({
        "file": name, "width": image.width, "height": image.height,
        "sourceSha256": hashlib.sha256((source / name).read_bytes()).hexdigest(),
        "rgbaSha256": hashlib.sha256(image.tobytes()).hexdigest(),
        "interpolationSamples": before[b"Grad"][b"Intr"].value,
        "colorMidpoints": [s[b"Mdpn"].value for s in before[b"Grad"][b"Clrs"]],
        "descriptorUnchanged": True, "grayRow": row,
        "savedCachesRGBA": [255, 0, 255, 255],
    })
output.write_text(json.dumps(report, indent=2) + "\n")
print(f"Verified {len(report['observations'])} regenerated gradients with unchanged definitions.")
