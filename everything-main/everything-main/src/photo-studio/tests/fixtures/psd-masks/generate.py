"""Generate original test documents with psd-tools 1.23.0 (MIT).

No downloaded images, proprietary assets, or production app codec are used.
Run with a Python environment containing psd-tools==1.23.0 and Pillow.
"""

from pathlib import Path
import struct

from PIL import Image
from psd_tools import PSDImage
from psd_tools.api.layers import Group, PixelLayer
from psd_tools.constants import ChannelID, Compression
from psd_tools.psd.layer_and_mask import (
    ChannelData,
    ChannelInfo,
    MaskData,
    MaskFlags,
    MaskParameters,
)

OUTPUT = Path(__file__).parent


def samples(depth):
    if depth == 8:
        return bytes([0, 1, 63, 128, 254, 255])
    if depth == 16:
        return struct.pack(">6H", 0, 1, 256, 32768, 65534, 65535)
    return struct.pack(">6f", -0.0, 2**-149, 0.0000125, 0.625, 1.0, 0.0)


for depth, version, compression in [
    (8, 1, Compression.RLE),
    (16, 2, Compression.ZIP),
    (32, 1, Compression.ZIP_WITH_PREDICTION),
]:
    psd = PSDImage.new("RGB", (7, 5), depth=depth)
    psd._record.header.version = version
    group = Group.new(psd, "Group")
    for with_real in [False, True]:
        layer = PixelLayer.frompil(
            Image.new("RGB", (3, 2), (21, 73, 161)),
            group,
            name="With real" if with_real else "Parameters only",
            compression=compression,
        )
        layer._record.mask_data = MaskData(
            top=-3, left=7, bottom=0, right=9, background_color=255,
            flags=MaskFlags(
                pos_relative_to_layer=True, invert_mask=True,
                parameters_applied=True, undocumented_3=True,
            ),
            parameters=MaskParameters(102, 2.375, 213, 7.125),
            **(dict(
                real_flags=MaskFlags(
                    mask_disabled=True, user_mask_from_render=True,
                    undocumented_2=True,
                ),
                real_background_color=0,
                real_top=9, real_left=-4, real_bottom=11, real_right=-1,
            ) if with_real else {}),
        )
        channels = [(ChannelID.USER_LAYER_MASK, 2, 3)]
        if with_real:
            channels.append((ChannelID.REAL_USER_LAYER_MASK, 3, 2))
        for channel_id, width, height in channels:
            data = ChannelData(compression)
            data.set_data(samples(depth), width, height, depth, version)
            layer._record.channel_info.append(ChannelInfo(channel_id))
            layer._channels.append(data)
    # Retain the deliberately blank composite: this fixture tests channels and
    # metadata without depending on the independent compositor's mask math.
    psd._update_record()
    with (OUTPUT / f"{depth}.{'psb' if version == 2 else 'psd'}").open("wb") as stream:
        psd._record.write(stream)

# Renderable primary masks, produced independently of the application's reader
# and writer. Keep blank composites so a successful render must use layers.
for depth, version, compression in [
    (8, 1, Compression.RLE),
    (16, 2, Compression.ZIP),
    (32, 1, Compression.ZIP_WITH_PREDICTION),
]:
    psd = PSDImage.new("RGB", (7, 5), depth=depth)
    psd._record.header.version = version
    group = Group.new(psd, "Editable group")
    layer = PixelLayer.frompil(Image.new("RGB", (5, 4), (21, 73, 161)), group,
                              name="Independent mask", left=-1, top=1, compression=compression)
    layer._record.mask_data = MaskData(
        top=0, left=2, bottom=3, right=4, background_color=255,
        flags=MaskFlags(pos_relative_to_layer=True, invert_mask=True,
                        parameters_applied=True, undocumented_3=True),
        parameters=MaskParameters(102, 0.0, 255, 0.0),
    )
    data=ChannelData(compression)
    data.set_data(samples(depth), 2, 3, depth, version)
    layer._record.channel_info.append(ChannelInfo(ChannelID.USER_LAYER_MASK))
    layer._channels.append(data)
    psd._update_record()
    with (OUTPUT / f"primary-{depth}.{'psb' if version == 2 else 'psd'}").open("wb") as stream:
        psd._record.write(stream)
