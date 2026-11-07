"""Original gradient descriptors encoded independently by MIT psd-tools.

No application codec, proprietary presets, fonts, profiles or other assets.
Locations retain the fixed 4096 range while Intr varies independently.
"""
from pathlib import Path
from PIL import Image
from psd_tools import PSDImage
from psd_tools.api.layers import PixelLayer
from psd_tools.constants import Tag, Compression
from psd_tools.psd.tagged_blocks import TaggedBlock
from psd_tools.psd.vector import VectorStrokeContentSetting
from psd_tools.psd.descriptor import (
    DescriptorBlock, Descriptor, String, UnitFloat, Double, Bool,
    Integer, Enumerated, List,
)
from psd_tools.terminology import Unit

root = Path(__file__).parent
def gradient(intr):
    grad = Descriptor(name="", classID=b"Grdn", items={
        b"Nm  ": String("Independent stops Ω\0"),
        b"GrdF": Enumerated(typeID=b"GrdF", enum=b"CstS"),
        b"Clrs": List([Descriptor(name="", classID=b"Clrt", items={
            b"Clr ": Descriptor(name="", classID=b"RGBC", items={
                b"Rd  ": Double(color[0]), b"Grn ": Double(color[1]), b"Bl  ": Double(color[2]),
            }), b"Type": Enumerated(typeID=b"Clry", enum=kind),
            b"Lctn": Integer(at), b"Mdpn": Integer(midpoint),
        }) for color, at, midpoint, kind in [
            ((23.125, 71.25, 161.5), 0, 17, b"UsrS"),
            ((241.5, 13.25, 41.125), 2048, 83, b"FrgC"),
            ((19.5, 239.125, 71.75), 4096, 50, b"BckC"),
        ]]),
        b"Trns": List([Descriptor(name="", classID=b"TrnS", items={
            b"Opct": UnitFloat(value=opacity, unit=Unit.Percent),
            b"Lctn": Integer(at), b"Mdpn": Integer(midpoint),
        }) for opacity, at, midpoint in [(12.345678901234567, 0, 29), (87.65432109876543, 3072, 71), (0, 4096, 50)]]),
    })
    if intr is not None: grad[b"Intr"] = Double(intr)
    return DescriptorBlock(name="", classID=b"gradientLayer", items={
        b"Grad": grad, b"Type": Enumerated(typeID=b"GrdT", enum=b"Rdl "),
        b"Angl": UnitFloat(value=-32.987654321098766, unit=Unit.Angle),
        b"Scl ": UnitFloat(value=137.12345678901235, unit=Unit.Percent),
        b"Dthr": Bool(True), b"Rvrs": Bool(False), b"Algn": Bool(False),
        b"Ofst": Descriptor(name="", classID=b"Pnt ", items={
            b"Hrzn": UnitFloat(value=-12.345678901234567, unit=Unit.Percent),
            b"Vrtc": UnitFloat(value=87.65432109876543, unit=Unit.Percent),
        }),
        b"gradientsInterpolationMethod": Enumerated(typeID=b"gradientInterpolationMethodType", enum=b"Lnr "),
    })

variants = {"zero": gradient(0), "fractional": gradient(137.375), "half": gradient(2048),
            "full": gradient(4096), "absent": gradient(None)}
variants["invalid-unit"] = gradient(2048)
variants["invalid-unit"][b"Scl "] = UnitFloat(value=100, unit=Unit.Angle)
variants["invalid-number"] = gradient(2048)
variants["invalid-number"][b"Grad"][b"Intr"] = Double(float("inf"))
variants["invalid-location"] = gradient(2048)
variants["invalid-location"][b"Grad"][b"Clrs"][0][b"Lctn"] = Integer(-1)
for label, descriptor in variants.items():
    (root / (label + ".bin")).write_bytes(descriptor.tobytes())
    for key in (Tag.GRADIENT_FILL_SETTING, Tag.VECTOR_STROKE_CONTENT_DATA):
        psd = PSDImage.new("RGB", (5, 3))
        layer = PixelLayer.frompil(Image.new("RGB", (5, 3), (23, 71, 163)), psd,
                                  name="Independent gradient", compression=Compression.RAW)
        psd._update_record()
        data = descriptor if key == Tag.GRADIENT_FILL_SETTING else VectorStrokeContentSetting(
            key=b"GdFl", version=16, classID=descriptor.classID, items=dict(descriptor.items()))
        layer._record.tagged_blocks[key] = TaggedBlock(key=key, data=data)
        with (root / (label + "-" + key.value.decode() + ".psd")).open("wb") as f:
            psd._record.write(f)
