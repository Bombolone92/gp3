"""Check production gradient exports independently with MIT psd-tools 1.23.

Run tests/browser/vector-gradients.spec.ts first, then:
python tests/fixtures/native-gradient-exports/validate.py /tmp/photo-editor-native-gradient-exports
These checks validate editable descriptors and channels, not pixels rendered by other applications.
"""
from pathlib import Path
import sys
import warnings
from psd_tools import PSDImage
from psd_tools.constants import Tag
from psd_tools.psd.descriptor import Double, UnitFloat
from psd_tools.terminology import Unit

root = Path(sys.argv[1])
styles = {"linear": b"Lnr ", "radial": b"Rdl ", "angle": b"Angl",
          "reflected": b"Rflc", "diamond": b"Dmnd"}
expected = {f"{backend}/{depth}-{version}-{style}.psd"
            for backend in ("default", "WebGL") for depth in (8, 16, 32)
            for version in ("psd", "psb") for style in styles}
files = sorted(root.rglob("*.psd"))
assert {str(p.relative_to(root)) for p in files} == expected
for path in files:
    depth, version, style = path.stem.split("-")
    with warnings.catch_warnings(record=True) as diagnostics:
        warnings.simplefilter("always")
        psd = PSDImage.open(path)
    assert not diagnostics, (path, diagnostics)
    assert psd.depth == int(depth) and psd._record.header.version == 1
    assert psd.size == (64 if version == "psb" else 32, 32)
    assert len(psd) == 1 and psd[0].name == "Gradient"
    layer = psd[0]
    record = layer._record
    assert (record.left, record.top, record.right, record.bottom) == (1, 2, 21, 18)
    assert record.opacity == 160
    assert all(not stream.data for stream in layer._channels)
    assert record.mask_data.background_color == 0
    assert record.mask_data.parameters.user_mask_density == 192
    assert record.tagged_blocks.get_data(Tag.VECTOR_MASK_SETTING1) is not None
    desc = record.tagged_blocks.get_data(Tag.GRADIENT_FILL_SETTING)
    assert desc is not None and desc[b"Type"].enum == styles[style]
    assert desc[b"Algn"].value is (version == "psd")
    assert desc[b"Dthr"].value is False
    for key, value, unit in ((b"Angl", 37, Unit.Angle), (b"Scl ", 137.375, Unit.Percent)):
        assert isinstance(desc[key], UnitFloat) and desc[key].unit == unit and desc[key].value == value
    assert desc[b"Ofst"][b"Hrzn"].value == 12.375
    assert desc[b"Ofst"][b"Vrtc"].value == -7.25
    grad = desc[b"Grad"]
    assert grad[b"Nm  "].value == "Independent Classic\x00"
    assert isinstance(grad[b"Intr"], Double) and grad[b"Intr"].value == 812.125
    colors = [(0,15,(23.125,71.25,163.5)), (1280,25,(241.5,32.125,44.25)), (4096,75,(211.375,217.625,53.75))]
    assert len(grad[b"Clrs"]) == len(colors)
    for stop, (location, midpoint, rgb) in zip(grad[b"Clrs"], colors):
        assert stop[b"Lctn"].value == location and stop[b"Mdpn"].value == midpoint
        assert stop[b"Type"].enum == b"UsrS"
        assert tuple(stop[b"Clr "][k].value for k in (b"Rd  ",b"Grn ",b"Bl  ")) == rgb
    opacities = [(0,50,13.125),(2560,30,87.375),(4096,70,52.875)]
    assert len(grad[b"Trns"]) == len(opacities)
    for stop, (location, midpoint, opacity) in zip(grad[b"Trns"], opacities):
        assert stop[b"Lctn"].value == location and stop[b"Mdpn"].value == midpoint
        assert isinstance(stop[b"Opct"], UnitFloat) and stop[b"Opct"].unit == Unit.Percent
        assert stop[b"Opct"].value == opacity
print(f"Verified {len(files)} production exports: exact live gradient descriptors, translated bounds, vector masks, opacity, mask density and empty color caches.")
