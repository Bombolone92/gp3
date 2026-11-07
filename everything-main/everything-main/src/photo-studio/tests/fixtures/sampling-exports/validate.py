"""Independently decode production exports with MIT psd-tools and BSD NumPy.

PHOTO_EDITOR_TEST_PORT=5275 PHOTO_EDITOR_SAMPLING_EXPORTS=/tmp/sampling-exports \
  npm run test:browser -- tests/browser/associated-sampling.spec.ts
python tests/fixtures/sampling-exports/validate.py /tmp/sampling-exports

The version in a filename describes the input. Production save chooses the
output version. Merged RGB/8 includes PSD's white matte at partial alpha;
individual layer channels and high-depth composites store straight samples.
"""
from pathlib import Path
import json
import math
import sys
import warnings

import numpy as np
from psd_tools import PSDImage

root = Path(sys.argv[1])
expected_files = {
    f"{backend}-{depth}-{version}-{rotation}.psd"
    for backend in ("default", "WebGL")
    for depth in (8, 16, 32)
    for version in ("psd", "psb")
    for rotation in (0, 27)
}
assert {p.name for p in root.glob("*.psd")} == expected_files
for file in sorted(root.glob("*.psd")):
    manifest = json.loads(file.with_suffix(".json").read_text())
    with warnings.catch_warnings(record=True) as diagnostics:
        warnings.simplefilter("always")
        psd = PSDImage.open(file)
    assert not diagnostics, (file, diagnostics)
    depth = manifest["depth"]
    assert psd.depth == depth and psd.size == (5, 4), file
    assert len(psd) == 1 and psd[0].is_group(), file
    assert psd[0].name == "Isolated group" and len(psd[0]) == 1, file
    child = psd[0][0]
    assert child.name == "Editable source" and child.bbox == (0, 0, 5, 4), file
    dtype = {8: np.uint8, 16: ">u2", 32: ">f4"}[depth]
    header = psd._record.header
    merged = np.stack([
        np.frombuffer(plane, dtype=dtype).reshape(4, 5)
        for plane in psd._record.image_data.get_data(header)
    ], axis=-1)
    expected = np.array(manifest["pixels"]).reshape(4, 5, 4)
    if depth == 8:
        alpha = expected[:, :, 3:4] / 255
        partial = (alpha > 0) & (alpha < 1)
        # The pinned byte writer adds the matte in a Uint8Array (truncation).
        expected[:, :, :3] = np.where(partial, np.floor(expected[:, :, :3] * alpha + 255 * (1 - alpha)), expected[:, :, :3])
    elif depth == 16:
        expected = np.floor(np.clip(expected, 0, 1) * 65535 + 0.5)
    assert np.array_equal(merged, expected.astype(dtype)), (file, "merged planes")
    actual = {}
    for info, channel in zip(child._record.channel_info, child._channels):
        actual[int(info.id)] = np.frombuffer(channel.get_data(5, 4, depth, header.version), dtype=dtype).reshape(4, 5)
    assert set(actual) == {-1, 0, 1, 2}, (file, "layer channels")
    source_unit = {8: 255, 16: 65535, 32: 1}[depth]
    source = np.array(manifest["source"]).reshape(2, 2, 4) / source_unit
    t = manifest["transform"]
    angle = math.radians(t["rotation"])
    isolated = np.zeros((4, 5, 4))
    for y in range(4):
        for x in range(5):
            dx, dy = x + 0.5 - t["x"] - t["width"] / 2, y + 0.5 - t["y"] - t["height"] / 2
            u = (dx * math.cos(angle) + dy * math.sin(angle)) / t["width"] + 0.5
            v = (-dx * math.sin(angle) + dy * math.cos(angle)) / t["height"] + 0.5
            if not (0 <= u <= 1 and 0 <= v <= 1 and x < 2 and y < 3):
                continue
            sx, sy = u * 2 - 0.5, v * 2 - 0.5
            ix, iy = math.floor(sx), math.floor(sy)
            fx, fy = sx - ix, sy - iy
            total = np.zeros(4)
            for tx, ty, weight in [(ix, iy, (1-fx)*(1-fy)), (ix+1, iy, fx*(1-fy)), (ix, iy+1, (1-fx)*fy), (ix+1, iy+1, fx*fy)]:
                pixel = source[max(0, min(1, ty)), max(0, min(1, tx))]
                total[:3] += pixel[:3] * pixel[3] * weight
                total[3] += pixel[3] * weight
            isolated[y, x, 3] = total[3]
            if total[3] > 0:
                isolated[y, x, :3] = total[:3] / total[3]
    unit = {8: 255, 16: 65535, 32: 1}[depth]
    if depth != 32:
        isolated = np.floor(np.clip(isolated, 0, 1) * unit + 0.5)
    for channel, component in [(0, 0), (1, 1), (2, 2), (-1, 3)]:
        tolerance = 1 if depth == 8 else 2 if depth == 16 else 0.000002
        assert np.max(np.abs(actual[channel].astype(float) - isolated[:, :, component])) <= tolerance, (file, channel)
print(f"Verified {len(expected_files)} production exports: exact merged planes, independently computed layer RGBA, hierarchy and depth; no decoder warnings.")
