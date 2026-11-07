"""Decode production RGB/32 exports independently with psd-tools and NumPy.

PHOTO_EDITOR_SOURCE_OVER_EXPORTS=/tmp/source-over-exports \
  npm run test:browser -- tests/browser/source-over.spec.ts
python tests/fixtures/source-over-exports/validate.py /tmp/source-over-exports
"""
import json
from pathlib import Path
import sys
import warnings

import numpy as np
from psd_tools import PSDImage

root = Path(sys.argv[1])
files = sorted(root.glob("*.psd"))
assert len(files) == 8
for file in files:
    manifest = json.loads(file.with_suffix(".json").read_text())
    width, height = manifest["width"], manifest["height"]
    with warnings.catch_warnings(record=True) as diagnostics:
        warnings.simplefilter("always")
        psd = PSDImage.open(file)
    assert not diagnostics, (file, diagnostics)
    assert psd.depth == 32 and psd.size == (width, height), file
    assert len(psd) == 1 and psd[0].is_group() and psd[0].name == "Isolation", file
    group = psd[0]
    assert group.opacity / 255 == manifest["groupOpacity"], file
    assert [layer.name for layer in group] == ["Background", "Foreground"], file
    for layer, key in zip(group, ["back", "front"]):
        assert layer.bbox == (0, 0, 2, 1), (file, key)
        channels = {int(info.id): np.frombuffer(channel.get_data(2, 1, 32, psd._record.header.version), dtype=">f4")
                    for info, channel in zip(layer._record.channel_info, layer._channels)}
        expected = np.array(manifest[key], dtype=np.float32).reshape(2, 4)
        for channel, component in [(0, 0), (1, 1), (2, 2), (-1, 3)]:
            assert np.array_equal(channels[channel], expected[:, component]), (file, key, channel)
    assert group[1].opacity / 255 == manifest["opacity"], file
    merged = np.stack([np.frombuffer(plane, dtype=">f4").reshape(height, width)
                       for plane in psd._record.image_data.get_data(psd._record.header)], axis=-1)
    actual = np.array(manifest["pixels"], dtype=np.float32).reshape(height, width, 4)
    assert np.array_equal(merged, actual), (file, "merged channels")
    # Float64 premultiplied sums retain products that the former float shader
    # underflowed, giving an oracle independent of its normalized-weight code.
    front = np.array(manifest["front"], dtype=np.float64).reshape(2, 4)
    back = np.array(manifest["back"], dtype=np.float64).reshape(2, 4)
    sa, ba = front[:, 3:4] * manifest["opacity"], back[:, 3:4]
    alpha = sa + ba * (1 - sa)
    expected = np.zeros((height, width, 4))
    expected[0, :2, :3] = (front[:, :3] * sa + back[:, :3] * ba * (1 - sa)) / alpha
    expected[0, :2, 3:4] = alpha * manifest["groupOpacity"]
    assert np.all(np.abs(actual - expected) <= np.maximum(1e-44, np.abs(expected) * 2e-6)), (file, "source-over")
print(f"Verified {len(files)} RGB/32 exports: original layer samples, opacity, hierarchy, exact merged channels and independent source-over; no decoder warnings.")
