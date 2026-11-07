"""Original pattern-fill descriptors encoded by MIT psd-tools 1.23.0.

No proprietary patterns, profiles, fonts or production application codec.
The percentage/angle deliberately retain all double-precision digits.
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
)
from psd_tools.terminology import Unit

OUTPUT = Path(__file__).parent


def descriptor(settings):
    return DescriptorBlock(name="", classID=b"patternFill", items={
        b"Ptrn": Descriptor(name="", classID=b"Ptrn", items={
            b"Nm  ": String("Original coordinate tile Ω\0"),
            b"Idnt": String("original-coordinate-tile\0"),
        }), **settings,
    }).tobytes()


full = {
    b"Scl ": UnitFloat(value=137.12345678901235, unit=Unit.Percent),
    b"Angl": UnitFloat(value=-32.987654321098766, unit=Unit.Angle),
    b"Algn": Bool(False),
    b"Lnkd": Bool(False),
    b"phase": Descriptor(name="", classID=b"Pnt ", items={
        b"Hrzn": Double(-12345.678901234567),
        b"Vrtc": Double(0.0000000000123456789),
    }),
}
for label, settings in [("default", {}), ("complete", full),
                        ("explicit-defaults", {
                            b"Scl ": UnitFloat(value=100, unit=Unit.Percent),
                            b"Angl": UnitFloat(value=0, unit=Unit.Angle),
                            b"Algn": Bool(True), b"Lnkd": Bool(True),
                            b"phase": Descriptor(name="", classID=b"Pnt ", items={
                                b"Hrzn": Double(0), b"Vrtc": Double(-0.0),
                            }),
                        }),
                        ("invalid-units", {**full, b"Scl ": UnitFloat(
                            value=100, unit=Unit.Angle)}),
                        ("invalid-number", {**full, b"Angl": UnitFloat(
                            value=float("inf"), unit=Unit.Angle)})]:
    encoded = descriptor(settings)
    (OUTPUT / (label + ".bin")).write_bytes(encoded)
    for key in (Tag.PATTERN_FILL_SETTING, Tag.VECTOR_STROKE_CONTENT_DATA):
        psd = PSDImage.new("RGB", (5, 3))
        layer = PixelLayer.frompil(Image.new("RGB", (5, 3), (23, 71, 163)),
                                   psd, name="Original pattern fill",
                                   compression=Compression.RAW)
        psd._update_record()
        desc = DescriptorBlock.frombytes(encoded)
        data = desc if key == Tag.PATTERN_FILL_SETTING else VectorStrokeContentSetting(
            key=b"PtFl", version=16, classID=desc.classID,
            items=dict(desc.items()))
        layer._record.tagged_blocks[key] = TaggedBlock(key=key, data=data)
        with (OUTPUT / (label + "-" + key.value.decode() + ".psd")).open("wb") as f:
            psd._record.write(f)
