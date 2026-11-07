"""Independently inspect cacheless rectangles with MIT psd-tools 1.23.0.

Run after tests/browser/psd-layer-bounds.spec.ts:
python tests/fixtures/cacheless-bounds-exports/validate.py /tmp/photo-editor-cacheless-bounds-exports
"""
from pathlib import Path
import sys
import warnings
from psd_tools import PSDImage
from psd_tools.constants import Tag
from psd_tools.psd.descriptor import Double, UnitFloat
from psd_tools.terminology import Unit

root = Path(sys.argv[1])
all_files = sorted(list(root.rglob("*.psd")) + list(root.rglob("*.psb")))
files = [path for path in all_files if not path.name.startswith("app-")]
app_files = [path for path in all_files if path.name.startswith("app-")]
expected = {f"{backend}/{depth}-{version}-{extent}.{version}"
            for backend in ("default", "WebGL") for depth in (8, 16, 32)
            for version in ("psd", "psb") for extent in (0, 1)}
assert {str(path.relative_to(root)) for path in files} == expected

for path in files:
    depth, version, extent = path.stem.split("-")
    depth, extent = int(depth), int(extent)
    with warnings.catch_warnings(record=True) as diagnostics:
        warnings.simplefilter("always")
        psd = PSDImage.open(path)
    assert not diagnostics, (path, diagnostics)
    assert psd.size == (37 + extent*20, 29 + extent*12) and psd.depth == depth
    assert psd._record.header.version == (2 if version == "psb" else 1)
    assert len(psd) == 1 and psd[0].is_group() and len(psd[0]) == 1
    group, layer = psd[0], psd[0][0]
    assert group.name == "Bounds group" and layer.name == "Aligned gradient"
    def rectangle(record):
        return (record.left, record.top, record.right, record.bottom)
    assert rectangle(group._record) == (-13, -17, 31, 43)
    assert rectangle(layer._record) == (-7 + extent*5, 4 + extent*3,
                                      13 + extent*15, 19 + extent*10)
    assert all(not stream.data for stream in layer._channels), path
    desc = layer._record.tagged_blocks.get_data(Tag.GRADIENT_FILL_SETTING)
    assert desc[b"Algn"].value is True and desc[b"Dthr"].value is False
    assert desc[b"Type"].enum == b"Lnr "
    assert isinstance(desc[b"Angl"], UnitFloat) and desc[b"Angl"].unit == Unit.Angle
    assert desc[b"Angl"].value == 37
    assert isinstance(desc[b"Scl "], UnitFloat) and desc[b"Scl "].unit == Unit.Percent
    assert desc[b"Scl "].value == 137.12345678901235
    assert desc[b"Ofst"][b"Hrzn"].value == -12.345678901234567
    assert desc[b"Ofst"][b"Vrtc"].value == 3.987654321012345
    assert isinstance(desc[b"Grad"][b"Intr"], Double)
    assert desc[b"Grad"][b"Intr"].value == 137.375
    assert layer._record.mask_data.parameters.user_mask_density == 192
app_expected = {f"{backend}/app-{depth}-{version}.psd"
                for backend in ("default", "WebGL") for depth in (8, 16, 32)
                for version in ("psd", "psb")}
assert {str(path.relative_to(root)) for path in app_files} == app_expected
for path in app_files:
    _, depth, source_version = path.stem.split("-")
    with warnings.catch_warnings(record=True) as diagnostics:
        warnings.simplefilter("always")
        psd = PSDImage.open(path)
    assert not diagnostics, (path, diagnostics)
    assert psd.size == (64 if source_version == "psb" else 32, 32)
    assert psd.depth == int(depth) and psd._record.header.version == 1
    assert len(psd) == 1 and psd[0].name == "Independent solid"
    layer = psd[0]
    assert rectangle(layer._record) == (-13, 3, 51, 27)
    assert all(not stream.data for stream in layer._channels)
    assert layer._record.mask_data.parameters.user_mask_density == 192
    desc = layer._record.tagged_blocks.get_data(Tag.SOLID_COLOR_SHEET_SETTING)
    color = desc[b"Clr "]
    assert [color[key].value for key in (b"Rd  ", b"Grn ", b"Bl  ")] == [31.125, 73.375, 137.5]
    mask = layer._record.tagged_blocks.get_data(Tag.VECTOR_MASK_SETTING1)
    assert mask is not None
print(f"Verified {len(app_files)} production exports: edited declarative bounds, live solid fill, vector mask, density and empty cache streams.")
print(f"Verified {len(files)} cacheless native exports: exact signed bounds, hierarchy, gradient placement, empty channel streams and mask density.")
