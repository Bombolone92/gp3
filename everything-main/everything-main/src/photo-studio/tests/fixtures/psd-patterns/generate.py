"""Original pattern resources, encoded with MIT psd-tools 1.23.0.

Run with Python containing psd-tools==1.23.0. No proprietary assets or production
application codec are used. Patterns use the same small RLE header in PSD/PSB.
"""
from pathlib import Path
import struct

from psd_tools.constants import ColorMode, Compression
from psd_tools.psd.patterns import (
    Patterns, Pattern, VirtualMemoryArrayList, VirtualMemoryArray,
)

OUTPUT = Path(__file__).parent


def plane(values, depth, size, compression, bounds=None):
    result = VirtualMemoryArray()
    raw = bytes(values) if depth == 8 else struct.pack(
        ">" + ("H" if depth == 16 else "f") * len(values), *values)
    result.set_data(size, raw, depth, compression)
    if bounds is not None:
        result.rectangle = bounds
    return result


def pattern(channels, mode, name, bounds=(3, 7, 5, 10), palette=None):
    # Color planes occupy the leading slots. The final two are user and sheet
    # masks, independent of the number of actually written color planes.
    slots = [VirtualMemoryArray() for _ in range(26)]
    for index, channel in channels.items():
        slots[index] = channel
    return Pattern(image_mode=mode, point=(2, 3), name="Independent " + name + " Ω",
                   pattern_id=name, color_table=palette,
                   data=VirtualMemoryArrayList(rectangle=bounds, channels=slots))


for depth in (8, 16, 32):
    rgb = ([0, 1, 63, 128, 254, 255] if depth == 8 else
           [0, 1, 256, 32768, 65534, 65535] if depth == 16 else
           [-0.0, 2**-149, -0.25, 0.625, 1.0, 2.75])
    alpha = rgb if depth != 32 else [-0.0, 2**-149, 0.0000125, 0.625, 1.0, 0.0]
    for compression in Compression:
        label = f"rgb-{depth}-{compression.value}"
        channels = {c: plane(rgb[c:] + rgb[:c], depth, (3, 2), compression,
                             (3, 7, 5, 10)) for c in range(3)}
        channels[25] = plane(alpha, depth, (3, 2), compression, (3, 7, 5, 10))
        (OUTPUT / f"{label}.bin").write_bytes(Patterns([
            pattern(channels, ColorMode.RGB, label)]).tobytes())

for mode, label in ((ColorMode.GRAYSCALE, "gray"), (ColorMode.INDEXED, "indexed")):
    channels = {0: plane([0, 1, 63, 128, 254, 255], 8, (3, 2), Compression.RLE,
                         (3, 7, 5, 10)),
                25: plane([255, 0, 1, 254, 128, 63], 8, (3, 2), Compression.RLE,
                          (3, 7, 5, 10))}
    palette = [(i, 255 - i, (i * 37) % 256) for i in range(256)] if label == "indexed" else None
    (OUTPUT / f"{label}.bin").write_bytes(Patterns([
        pattern(channels, mode, label, palette=palette)]).tobytes())

# Partial planes and a written-but-empty VMA exercise length and rectangle
# handling without assuming each channel is the full tile or sequentially packed.
channels = {0: plane([21] * 6, 8, (3, 2), Compression.RLE, (3, 7, 5, 10)),
            1: plane([73] * 6, 8, (3, 2), Compression.RAW, (3, 7, 5, 10)),
            2: plane([161] * 6, 8, (3, 2), Compression.ZIP, (3, 7, 5, 10)),
            10: VirtualMemoryArray(is_written=1),
            25: plane([0, 128], 8, (1, 2), Compression.RLE, (3, 8, 5, 9))}
(OUTPUT / "partial.bin").write_bytes(Patterns([
    pattern(channels, ColorMode.RGB, "partial")]).tobytes())
