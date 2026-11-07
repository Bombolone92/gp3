"""Independently validate original/edited browser gradient-codec exports.

PHOTO_EDITOR_GRADIENT_EXPORTS=/tmp/gradient-exports npm run test:browser -- tests/browser/psd-gradients.spec.ts
python tests/fixtures/psd-gradient-fills/validate.py /tmp/gradient-exports
"""
from pathlib import Path
import math
import sys
import warnings
from psd_tools import PSDImage
from psd_tools.constants import Tag
from psd_tools.psd.descriptor import DescriptorBlock, Descriptor, List, UnitFloat, Double, Enumerated
from psd_tools.terminology import Unit

fixtures, root = Path(__file__).parent, Path(sys.argv[1])
files = sorted([*root.rglob("*.psd"), *root.rglob("*.psb")])
assert len(files) == 264, f"Expected 264 original/edited/opaque exports, found {len(files)}"
def compare(left, right, where):
    # Descriptor class names are UI hints; class IDs, field keys, types and
    # values carry the format semantics. Lists retain original order.
    if isinstance(left, Descriptor):
        assert left.classID == right.classID, (where, left.classID, right.classID)
        assert set(left.keys()) == set(right.keys()), (where, left, right)
        for key in left: compare(left[key], right[key], (where, key))
    elif isinstance(left, List):
        assert len(left) == len(right), where
        for i, (a, b) in enumerate(zip(left, right)): compare(a, b, (where, i))
    else:
        assert type(left) is type(right), (where, type(left), type(right))
        if isinstance(left, Enumerated):
            assert left.enum == right.enum and left.typeID == right.typeID, (where, left, right)
            return
        assert left.value == right.value, (where, left.value, right.value)
        if isinstance(left, UnitFloat): assert left.unit == right.unit, where
        if isinstance(left, (Double, UnitFloat)):
            assert math.copysign(1, left.value) == math.copysign(1, right.value), where
        if hasattr(left, "typeID"): assert left.typeID == right.typeID, where

for file in files:
    label, key, depth = file.stem.rsplit("-", 2)
    edited = label.startswith("edited-")
    opaque = label.startswith("opaque-")
    if edited: label = label.removeprefix("edited-")
    if opaque: label = label.removeprefix("opaque-")
    source = DescriptorBlock.frombytes((fixtures / (label + ".bin")).read_bytes())
    if opaque:
        source[b"Grad"][b"Trns"].pop(1)
        for stop in source[b"Grad"][b"Trns"]:
            stop[b"Opct"] = UnitFloat(100.0, Unit.Percent)
            stop[b"Mdpn"].value = 50
    if edited:
        source[b"Grad"][b"Intr"] = Double(2048.125)
        source[b"Scl "] = UnitFloat(73.65432198765432, Unit.Percent)
        source[b"Angl"] = UnitFloat(-0.0, Unit.Angle)
        source[b"Ofst"][b"Hrzn"] = UnitFloat(-0.0, Unit.Percent)
        source[b"Ofst"][b"Vrtc"] = UnitFloat(-987.1234567890123, Unit.Percent)
        source[b"Grad"][b"Trns"][2][b"Opct"] = UnitFloat(5e-324, Unit.Percent)
        source[b"Grad"][b"Clrs"][1][b"Lctn"].value = 1023
    with warnings.catch_warnings(record=True) as diagnostics:
        warnings.simplefilter("always")
        psd = PSDImage.open(file)
    assert not diagnostics, (file, diagnostics)
    assert psd.depth == int(depth) and psd.size == (5, 3), file
    assert psd._record.header.version == (2 if file.suffix == ".psb" else 1), file
    assert len(psd) == 1 and psd[0].name == "Editable gradient", file
    tag = Tag.GRADIENT_FILL_SETTING if key == "GdFl" else Tag.VECTOR_STROKE_CONTENT_DATA
    actual = psd[0]._record.tagged_blocks[tag].data
    assert set(source.keys()) == set(actual.keys()), file
    if key == "vscg":
        assert actual.key == b"GdFl" and actual.version == 16, file
        stroke = psd[0]._record.tagged_blocks[Tag.VECTOR_STROKE_DATA].data
        assert stroke[b"strokeStyleOpacity"].value == 0.123456789 * 100, file
    for field in source: compare(source[field], actual[field], (file, field))
print(f"Verified {len(files)} gradient definitions: exact original/edited types, units, values, stop identities, defaults, hierarchy, depth, version and stroke opacity; no decoder warnings.")
