"""Original MIT font fixtures encoded as MTX using the published C LZ codec.

Requires Python stdlib, fonttools==4.65.0 (MIT, build only), clang, and node.
No third-party font data. The independent FontTools reader verifies every
reconstructed outline, component, metric table and glyph instruction stack.
"""

from array import array
import importlib.util
import json
import re
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
from urllib.request import urlopen

from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables.ttProgram import Program

ROOT = Path(__file__).resolve().parent.parent
sys.dont_write_bytecode = True
DATA = ROOT / "tests/data/font-formats"
spec = importlib.util.spec_from_file_location("mtx_reference", ROOT / "tests/fixtures/fonts/generate-mtx-vectors.py")
reference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)


def published_triplets():
    class Tables(HTMLParser):
        def __init__(self):
            super().__init__(); self.tables = []; self.table = None; self.row = None; self.cell = None
        def handle_starttag(self, tag, attrs):
            if tag == "table": self.table = []
            if tag == "tr": self.row = []
            if tag in ("td", "th"): self.cell = []
        def handle_data(self, text):
            if self.cell is not None: self.cell.append(text)
        def handle_endtag(self, tag):
            if tag in ("td", "th") and self.cell is not None:
                self.row.append(" ".join("".join(self.cell).split())); self.cell = None
            if tag == "tr" and self.row is not None:
                self.table.append(self.row); self.row = None
            if tag == "table" and self.table is not None:
                self.tables.append(self.table); self.table = None
    parser = Tables()
    with urlopen(reference.URL) as response:
        parser.feed(response.read().decode("utf-8"))
    rows = next(table[1:] for table in parser.tables if any("X bits" in row for row in table))
    if len(rows) != 128:
        raise RuntimeError("Published triplet table changed; inspect before regeneration")
    previous, vectors = [""] * 8, []
    for row in rows:
        # Expand cells inherited through HTML rowspans; do not duplicate the
        # runtime's arithmetic dispatch for the 128 flag combinations.
        row = [value or previous[i] for i, value in enumerate(row)]; previous = row
        index, size, xbits, ybits, dx, dy, xsign, ysign = row
        xbits, ybits = int(xbits), int(ybits)
        x = {0: 0, 4: 11, 8: 123, 12: 0x57B, 16: 0x157B}[xbits]
        y = {0: 0, 4: 9, 8: 73, 12: 0x349, 16: 0x2349}[ybits]
        payload = ((x << ybits) | y).to_bytes(int(size) - 1, "big")
        x = (x + (0 if dx == "N/A" else int(dx))) * (-1 if xsign == "-" else 1)
        y = (y + (0 if dy == "N/A" else int(dy))) * (-1 if ysign == "-" else 1)
        vectors.append(dict(flag=int(index), payload=list(payload), dx=x, dy=y))
    path = ROOT / "tests/fixtures/fonts/mtx-triplets.json"
    text = json.dumps(dict(source=reference.URL + "#TripletEncoding", vectors=vectors), indent=2)
    text = re.sub(r'"payload": \[([^\]]*)\]', lambda match: '"payload": [' + ", ".join(str(int(value)) for value in match[1].split(",") if value.strip()) + "]", text)
    path.write_text(text + "\n")


def ushort(value):
    if value < 253:
        return bytes([value])
    if value <= 508:
        return bytes([255, value - 253])
    if value <= 761:
        return bytes([254, value - 506])
    return bytes([253]) + struct.pack(">H", value)


def short(value):
    magnitude = abs(value)
    if magnitude > 755:
        return bytes([253]) + struct.pack(">h", value)
    sign = bytes([250]) if value < 0 else b""
    if magnitude < 250:
        return sign + bytes([magnitude])
    if magnitude <= 505:
        return sign + bytes([255, magnitude - 250])
    return sign + bytes([254, magnitude - 500])


def split_pushes(code):
    values, at = [], 0
    while at < len(code):
        opcode = code[at]
        if opcode in (0x40, 0x41):
            count, word, start = code[at + 1], opcode == 0x41, at + 2
        elif 0xB0 <= opcode <= 0xBF:
            count, word, start = (opcode & 7) + 1, opcode >= 0xB8, at + 1
        else:
            break
        for i in range(count):
            values.append(struct.unpack_from(">h", code, start + i * 2)[0] if word else code[start + i])
        at = start + count * (2 if word else 1)
    return values, code[at:]


def push_data(values):
    result, at = bytearray(), 0
    while at < len(values):
        if at >= 2 and at + 4 < len(values) and values[at] == values[at - 2] == values[at + 2] == values[at + 4]:
            result.extend(bytes([252]) + short(values[at + 1]) + short(values[at + 3])); at += 5
        elif at >= 2 and at + 2 < len(values) and values[at] == values[at - 2] == values[at + 2]:
            result.extend(bytes([251]) + short(values[at + 1])); at += 3
        else:
            result.extend(short(values[at])); at += 1
    return result


def glyph_streams(font):
    outlines, pushes, code = bytearray(), bytearray(), bytearray()
    for index, name in enumerate(font.getGlyphOrder()):
        glyph = font["glyf"][name]
        program = bytes(glyph.program.getBytecode()) if hasattr(glyph, "program") else b""
        values, remaining = split_pushes(program)
        if glyph.isComposite():
            native = glyph.compile(font["glyf"])
            outlines.extend(native[:10])
            at, flags = 10, 32
            while flags & 32:
                flags = struct.unpack_from(">H", native, at)[0]
                at += 4 + (4 if flags & 1 else 2) + (2 if flags & 8 else 4 if flags & 64 else 8 if flags & 128 else 0)
            outlines.extend(native[10:at])
            if flags & 256:
                outlines.extend(ushort(len(values)) + ushort(len(remaining)))
        else:
            contours = glyph.numberOfContours
            explicit = bool(contours and index % 2 == 0)
            outlines.extend(struct.pack(">hh", 0x7FFF, contours) if explicit else struct.pack(">h", contours))
            if explicit:
                outlines.extend(struct.pack(">hhhh", glyph.xMin, glyph.yMin, glyph.xMax, glyph.yMax))
            coordinates, endpoints, flags = glyph.getCoordinates(font["glyf"])
            for i, endpoint in enumerate(endpoints):
                outlines.extend(ushort(endpoint if i == 0 else endpoint - endpoints[i - 1]))
            deltas, x, y = [], 0, 0
            for px, py in coordinates:
                deltas.append((px - x, py - y)); x, y = px, py
            outlines.extend(bytes(124 + int(dx >= 0) + 2 * int(dy >= 0) + (0 if flag & 1 else 128) for (dx, dy), flag in zip(deltas, flags)))
            for dx, dy in deltas:
                outlines.extend(struct.pack(">HH", abs(dx), abs(dy)))
            outlines.extend(ushort(len(values)) + ushort(len(remaining)))
        pushes.extend(push_data(values)); code.extend(remaining)
    return bytes(outlines), bytes(pushes), bytes(code)


def magnitude_bits(values):
    bits = []
    for value in values:
        bits.extend([1] * abs(value)); bits.append(0)
        if value:
            bits.append(int(value < 0))
    result = bytearray((len(bits) + 7) // 8)
    for i, bit in enumerate(bits):
        result[i // 8] |= bit << (i % 8)
    return bytes(result)


def cvt_table(font):
    values, result, previous = font["cvt "].values, bytearray(), 0
    result.extend(struct.pack(">H", len(values)))
    for value in values:
        delta = (value - previous + 32768) % 65536 - 32768; previous = value
        magnitude, negative = abs(delta), delta < 0
        quotient, remainder = divmod(magnitude, 238)
        if quotient > 8 or delta == -32768:
            result.extend(bytes([238]) + struct.pack(">h", delta))
        elif negative:
            result.extend(bytes([239 + quotient, remainder]))
        elif quotient:
            result.extend(bytes([247 + quotient, remainder]))
        else:
            result.append(remainder)
    return bytes(result)


def hdmx_table(font, native):
    count, size = struct.unpack_from(">HI", native, 2)
    result, errors = bytearray(native[:8]), []
    for i in range(count):
        at = 8 + i * size
        ppem = native[at]; result.extend(native[at:at + 2])
        for glyph, width in zip(font.getGlyphOrder(), native[at + 2:at + 2 + len(font.getGlyphOrder())]):
            advance = font["hmtx"].metrics[glyph][0]
            scaled = (64 * ppem * advance + font["head"].unitsPerEm // 2) // font["head"].unitsPerEm
            errors.append(width - (scaled + 32) // 64)
    return bytes(result) + magnitude_bits(errors)


def vdmx_table(font, native, compressed_offsets=False):
    table = font["VDMX"]
    header_size = 6 + table.numRatios * 6
    result, offsets = bytearray(native[:header_size]), []
    for group in table.groups:
        offsets.append(len(result))
        max_mult, min_mult = 1536, 512
        result.extend(struct.pack(">Hhh", len(group), max_mult, min_mult))
        errors, predicted = [], 8
        for ppem, (ymax, ymin) in sorted(group.items()):
            errors.extend([ppem - predicted, ymax - (ppem * max_mult + 1024) // 2048, ymin + (ppem * min_mult + 1024) // 2048])
            predicted = ppem + 1
        result.extend(magnitude_bits(errors))
    if compressed_offsets:
        for i, ratio in enumerate(table.ratRanges):
            struct.pack_into(">H", result, 6 + table.numRatios * 4 + i * 2, offsets[ratio["groupIndex"]])
    return bytes(result)


def sfnt(tables, font, native):
    count = len(tables)
    result = bytearray(12 + count * 16)
    result[:12] = native[:12]
    for i, (tag, data) in enumerate(sorted(tables.items())):
        offset = 0 if tag == "loca" else len(result)
        struct.pack_into(">4sIII", result, 12 + i * 16, tag.encode(), font.reader.tables[tag].checkSum, offset, len(data))
        result.extend(data); result.extend(bytes(-len(result) % 4))
    return bytes(result)


def complex_font():
    font = TTFont(DATA / "Regular.ttf", recalcTimestamp=False)
    shapes = {}
    pen = TTGlyphPen(None); shapes["space"] = pen.glyph()
    pen = TTGlyphPen(None)
    pen.moveTo((20, 0)); pen.qCurveTo((250, 760), (480, 0)); pen.closePath()
    shapes["curve"] = pen.glyph()
    pen = TTGlyphPen(None)
    for points in [[(40, 0), (280, 710), (520, 0)], [(220, 160), (340, 160), (280, 340)]]:
        pen.moveTo(points[0])
        for point in points[1:]: pen.lineTo(point)
        pen.closePath()
    shapes["multi"] = pen.glyph()
    glyph_set = {**font["glyf"].glyphs, **shapes}
    for name, matrix in [("scaled", (0.75, 0, 0, 0.75, 30, -20)), ("xy", (0.8, 0, 0, 1.1, -20, 40)), ("matrix", (1, 0.125, -0.25, 1, 60, 20))]:
        pen = TTGlyphPen(glyph_set)
        pen.addComponent("curve", matrix); pen.addComponent("A", (1, 0, 0, 1, 500, 0))
        shapes[name] = pen.glyph(); glyph_set[name] = shapes[name]
    pen = TTGlyphPen(glyph_set); pen.addComponent("scaled", (1, 0, 0, 1, 10, 20)); shapes["nested"] = pen.glyph()
    font["glyf"].glyphs.update(shapes)
    order = font.getGlyphOrder() + list(shapes); font.setGlyphOrder(order)
    for table in font["cmap"].tables:
        if table.isUnicode():
            table.cmap.update({32: "space", 67: "curve", 68: "multi", 83: "scaled", 88: "xy", 77: "matrix", 78: "nested"})
    for name in shapes: font["hmtx"].metrics[name] = (700, 20)
    font["hmtx"].metrics["space"] = (300, 0)
    values = [4, 7, 4, 300, 4, -500, 4, -32768, 32767, 250, 755]
    hint = bytes([0x41, len(values)]) + struct.pack(">" + "h" * len(values), *values) + bytes([0x21]) * len(values)
    for name in ("curve", "multi", "scaled"):
        font["glyf"][name].program = Program(); font["glyf"][name].program.fromBytecode(hint)
    font["maxp"].maxStackElements = len(values)
    font["cvt "] = newTable("cvt "); font["cvt "].values = array("h", [0, 237, 475, -10, -2159, 32760, -32760, -32768, 0])
    font["hdmx"] = newTable("hdmx")
    font["hdmx"].hdmx = {size: {name: round(size * font["hmtx"].metrics[name][0] / 1000) + (i % 3 - 1) for i, name in enumerate(order)} for size in (11, 17, 23)}
    font["VDMX"] = newTable("VDMX"); v = font["VDMX"]
    v.version = 1; v.numRecs = 2; v.numRatios = 3
    v.ratRanges = [dict(bCharSet=1, xRatio=1, yStartRatio=1, yEndRatio=1, groupIndex=0), dict(bCharSet=1, xRatio=2, yStartRatio=1, yEndRatio=2, groupIndex=1), dict(bCharSet=1, xRatio=0, yStartRatio=0, yEndRatio=0, groupIndex=0)]
    v.groups = [{8: (7, -2), 9: (7, -3), 11: (9, -3)}, {9: (8, -3), 12: (10, -3), 16: (13, -5), 17: (13, -4)}]
    buffer = BytesIO(); font.save(buffer); return buffer.getvalue()


def verify(native, rebuilt):
    source, copy = TTFont(BytesIO(native)), TTFont(BytesIO(rebuilt))
    assert source.getGlyphOrder() == copy.getGlyphOrder()
    for tag in source.keys():
        if tag not in ("GlyphOrder", "glyf", "loca", "head", "maxp"):
            assert source.getTableData(tag) == copy.getTableData(tag), tag
    for name in source.getGlyphOrder():
        a, b = source["glyf"][name], copy["glyf"][name]
        assert a.numberOfContours == b.numberOfContours, name
        assert a.getCoordinates(source["glyf"]) == b.getCoordinates(copy["glyf"]), name
        if a.numberOfContours:
            assert [getattr(a, key) for key in ("xMin", "yMin", "xMax", "yMax")] == [getattr(b, key) for key in ("xMin", "yMin", "xMax", "yMax")], name
        if a.isComposite():
            assert [c.getComponentInfo() for c in a.components] == [c.getComponentInfo() for c in b.components], name
        for glyph in (a, b):
            if not hasattr(glyph, "program"): glyph.program = Program(); glyph.program.fromBytecode(b"")
        assert split_pushes(bytes(a.program.getBytecode())) == split_pushes(bytes(b.program.getBytecode())), name
    words = struct.unpack(">" + "I" * (len(rebuilt) // 4), rebuilt)
    assert sum(words) % 2**32 == 0xB1B0AFBA


def generate(work):
    source, program = work / "reference.c", work / "reference"
    source.write_text(reference.reference_source())
    subprocess.run(["clang", "-std=gnu89", str(source), "-lm", "-o", str(program)], check=True)
    sources = {name: (DATA / f"{name}.ttf").read_bytes() for name in ("Regular", "Bold", "Italic", "BoldItalic", "PreviewPrint", "Wide", "Plus")}
    sources.update({"Complex": complex_font(), "ComplexOffsets": complex_font(), "ComplexRawMetrics": complex_font()})
    for name, native in sources.items():
        font = TTFont(BytesIO(native), recalcTimestamp=False); glyphs, pushes, code = glyph_streams(font)
        tables = {tag: font.getTableData(tag) for tag in font.keys() if tag != "GlyphOrder"}
        tables.update(glyf=glyphs, loca=b"")
        if "cvt " in tables: tables["cvt "] = cvt_table(font)
        if "hdmx" in tables:
            tables["hdmx"] = (bytes([255, 255]) + tables["hdmx"][2:]) if name.endswith("RawMetrics") else hdmx_table(font, tables["hdmx"])
        if "VDMX" in tables:
            tables["VDMX"] = (bytes([255, 254]) + tables["VDMX"][2:]) if name.endswith("RawMetrics") else vdmx_table(font, tables["VDMX"], name.endswith("Offsets"))
        blocks = []
        for data in (sfnt(tables, font, native), pushes, code):
            input_path, output_path = work / "input", work / "compressed"
            input_path.write_bytes(data)
            subprocess.run([str(program), "pack", str(input_path), str(output_path), "16777215"], check=True)
            packed = output_path.read_bytes()
            subprocess.run([str(program), "unpack", str(output_path), str(work / "decoded"), "16777215"], check=True)
            assert (work / "decoded").read_bytes() == data
            blocks.append(packed)
        header = bytes([3]) + bytes([255, 255, 255]) + (10 + len(blocks[0])).to_bytes(3, "big") + (10 + len(blocks[0]) + len(blocks[1])).to_bytes(3, "big")
        mtx = header + b"".join(blocks)
        input_path, output_path = work / "font.mtx", work / "font.ttf"
        input_path.write_bytes(mtx)
        subprocess.run(["node", "--input-type=module", "-e", "import {readFileSync,writeFileSync} from 'node:fs'; import {decodeMtxFont} from './lib/pptx/src/internal/fonts/mtx.ts'; writeFileSync(process.argv[2],decodeMtxFont(readFileSync(process.argv[1])));", str(input_path), str(output_path)], cwd=ROOT, check=True)
        verify(native, output_path.read_bytes())
        (DATA / f"{name}.mtx").write_bytes(mtx)
        if name.startswith("Complex"): (DATA / f"{name}.ttf").write_bytes(native)
        print(f"Verified {name}: outlines, components, hint stack, tables, checksums")


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="mtx-fonts-") as directory:
        generate(Path(directory))
    published_triplets()
