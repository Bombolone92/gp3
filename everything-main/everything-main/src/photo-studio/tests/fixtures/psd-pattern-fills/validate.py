"""Validate browser codec exports with independent MIT psd-tools 1.23.0.

Run: python validate.py /tmp/photo-editor-pattern-fill-exports
The browser regression writes PSD/PSB files at each depth on both backends.
"""
from pathlib import Path
import math
import sys
import warnings
from psd_tools import PSDImage
from psd_tools.constants import Tag
from psd_tools.psd.descriptor import DescriptorBlock

FIXTURES = Path(__file__).parent
root = Path(sys.argv[1])
files = sorted(list(root.rglob("*.psd")) + list(root.rglob("*.psb")))
assert len(files) == 72, f"Expected 72 exports, found {len(files)}"
for path in files:
    label, key, depth = path.stem.rsplit("-", 2)
    source = DescriptorBlock.frombytes((FIXTURES / (label + ".bin")).read_bytes())
    with warnings.catch_warnings(record=True) as diagnostics:
        warnings.simplefilter("always")
        psd = PSDImage.open(path)
    assert not diagnostics, (path, diagnostics)
    assert psd.depth == int(depth) and psd.size == (5, 3)
    assert psd._record.header.version == (2 if path.suffix == ".psb" else 1)
    assert len(psd) == 1 and psd[0].name == "Editable pattern"
    block_key = Tag.PATTERN_FILL_SETTING if key == "PtFl" else Tag.VECTOR_STROKE_CONTENT_DATA
    actual = psd[0]._record.tagged_blocks[block_key].data
    assert set(source.keys()) == set(actual.keys()), (path, source, actual)
    if key == "vscg":
        assert actual.key == b"PtFl" and actual.version == 16
        stroke = psd[0]._record.tagged_blocks[Tag.VECTOR_STROKE_DATA].data
        assert stroke[b"strokeStyleOpacity"].value == 0.123456789 * 100
    for field in source:
        left, right = source[field], actual[field]
        if field in (b"Ptrn", b"phase"):
            assert left.classID == right.classID
            assert set(left.keys()) == set(right.keys())
            for member in left:
                assert type(left[member]) is type(right[member]), (path, field, member)
                assert left[member].value == right[member].value, (path, field, member)
                if field == b"phase":
                    assert math.copysign(1, left[member].value) == math.copysign(1, right[member].value)
        else:
            assert type(left) is type(right), (path, field)
            assert left.value == right.value, (path, field, left.value, right.value)
            if field in (b"Scl ", b"Angl"):
                assert left.unit == right.unit, (path, field)
print(f"Verified {len(files)} independently decoded pattern-fill descriptors: exact values/types/defaults, hierarchy, depth, file version and stroke opacity.")
