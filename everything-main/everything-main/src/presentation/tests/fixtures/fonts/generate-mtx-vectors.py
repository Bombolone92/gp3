"""Regenerate independent LZCOMP vectors with W3C's published C codec.

Python stdlib + clang only; no runtime decoder or third-party font bytes.
All plaintext/tokens here are project-owned synthetic test data (MIT).
The reference sample has Monotype's permissive, sublicensable grant:
https://www.w3.org/standards/licensing/
"""

import base64
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
URL = "https://www.w3.org/submissions/MTX/"
REFERENCE_HASH = "725b4308aa52463f0225edf04924b680c576f62e1e7b9d42c07c25b86c3c2a2c"


class Samples(HTMLParser):
    def __init__(self):
        super().__init__()
        self.current = None
        self.blocks = []

    def handle_starttag(self, tag, attrs):
        if tag == "pre":
            self.current = []

    def handle_endtag(self, tag):
        if tag == "pre" and self.current is not None:
            self.blocks.append("".join(self.current).replace("\r\n", "\n"))
            self.current = None

    def handle_data(self, text):
        if self.current is not None:
            self.current.append(text)


def reference_source():
    parser = Samples()
    with urlopen(URL) as response:
        parser.feed(response.read().decode("utf-8"))
    source = next(block for block in parser.blocks if "MTX_LZCOMP_PackMemory" in block)
    if hashlib.sha256(source.encode()).hexdigest() != REFERENCE_HASH:
        raise RuntimeError("Published reference changed; inspect before regeneration")
    # The sample is concatenated headers/sources, originally for 32-bit C.
    source = re.sub(r'^#include "[^"\n]+"\n', "", source, flags=re.M)
    source = source.replace("#define sizeof_hasnNodePtr 4", "#define sizeof_hasnNodePtr sizeof(hasnNode *)")
    source = source.replace("register usingRunLength", "register int usingRunLength")
    # Obsolete huge-pointer increment casts are not legal in modern C.
    source = re.sub(
        r"void \* memcpyHuge\([^\n]*\n\{.*?\n\}",
        "void *memcpyHuge(void *dst, void *src, unsigned long n) { return memcpy(dst, src, n); }",
        source, flags=re.S,
    )
    prefix = "#include <stdlib.h>\n#include <stdio.h>\n#include <stdbool.h>\n#define COMPRESS_ON\n#define DECOMPRESS_ON\n#define __huge\n"
    return prefix + source + (ROOT / "mtx-reference-driver.c").read_text()


def patterned(size):
    # Repeat a non-uniform motif, exercising many adaptive symbols without RLE.
    return (bytes(range(251)) * ((size + 250) // 251))[:size]


def random_bytes(size):
    # Deterministic generator independent of Python's random implementation.
    value, result = 0x12345678, bytearray()
    for _ in range(size):
        value = (1664525 * value + 1013904223) & 0xFFFFFFFF
        result.append(value >> 24)
    return bytes(result)


PRESET = bytes(v for k in range(32) for j in range(96) for v in (k, j)) + bytes(v for j in range(256) for v in (j,) * 4)


def token_plaintext(tokens):
    history = bytearray(PRESET)
    for kind, a, b in tokens:
        if kind == "l":
            history.append(a)
        elif kind == "d":
            history.append(history[-a])
        elif kind == "c":
            start = len(history) - b - a + 1
            if start < 0:
                raise ValueError("invalid synthetic copy")
            history.extend(history[start:start + a])
        else:
            raise ValueError("raw tree symbols require a supplied expectation")
    return bytes(history[len(PRESET):])


def expand_runs(data):
    escape, result, at = data[0], bytearray(), 1
    while at < len(data):
        value = data[at]
        at += 1
        if value != escape:
            result.append(value)
        else:
            count = data[at]
            at += 1
            if count:
                result.extend(bytes([data[at]]) * count)
                at += 1
            else:
                result.append(escape)
    return bytes(result)


def doubled_tokens(size):
    tokens, available = [("l", 53, 0)], 1
    while available < size:
        count = min(available, size - available)
        tokens.append(("c", count, 1) if count > 1 else ("l", 53, 0))
        available += count
    return tokens


def generate(work):
    compiler_input, program = work / "reference.c", work / "reference"
    compiler_input.write_text(reference_source())
    subprocess.run(["clang", "-std=gnu89", str(compiler_input), "-lm", "-o", str(program)], check=True)
    vectors = []

    def call(mode, data, copy_limit):
        input_path, output_path = work / "input", work / "output"
        input_path.write_bytes(data)
        subprocess.run([str(program), mode, str(input_path), str(output_path), str(copy_limit)], check=True)
        return output_path.read_bytes()

    def record(name, compressed, expected, copy_limit, error=None):
        item = {"name": name, "copyLimit": copy_limit, "compressed": base64.b64encode(compressed).decode()}
        if error:
            item["error"] = error
        else:
            # Compare the independent reference decoder too, before recording
            # a digest. Malformed vectors never enter the unbounded C reader.
            actual = call("unpack", compressed, copy_limit)
            if actual != expected:
                raise AssertionError(f"reference disagrees with plaintext: {name}")
            item.update(length=len(expected), sha256=hashlib.sha256(expected).hexdigest())
            if len(expected) < 64:
                item["plaintext"] = base64.b64encode(expected).decode()
        vectors.append(item)

    def packed(name, data, copy_limit=0xFFFFFF):
        record(name, call("pack", data, copy_limit), data, copy_limit)

    def symbols(name, tokens, length=None, rle=False, copy_limit=0xFFFFFF, error=None, plaintext=None):
        intermediate = None if error else plaintext if plaintext is not None else token_plaintext(tokens)
        if length is None:
            length = len(intermediate)
        commands = f"{length} {int(rle)}\n" + "".join(f"{kind} {a} {b}\n" for kind, a, b in tokens)
        compressed = call("symbols", commands.encode(), copy_limit)
        expected = None if error else expand_runs(intermediate) if rle else intermediate
        record(name, compressed, expected, copy_limit, error)

    packed("empty", b"")
    packed("one literal", b"A")
    packed("all byte values", bytes(range(256)))
    packed("long run-length expansion", bytes([144]) * 20000)
    packed("runs containing every escape candidate", bytes(range(256)) + b"\0" * 4096 + b"\xFF" * 3000)
    for length in (7, 8, 9, 63, 64, 65, 511, 512, 513, 4095, 4096, 4097, 32768, 32769):
        packed(f"motif length {length}", patterned(length))
    for limit in (0, 7232, 8192, 0xFFFFFF):
        packed(f"random data window {limit}", random_bytes(18000), limit)
        packed(f"wrapped motif window {limit}", patterned(24000), limit)
    packed("adaptive weights exceed 32767", random_bytes(60000), 8192)
    symbols("biased tree is never rescaled", [("l", 37 + i % 2, 0) for i in range(40000)])
    for distance in (2, 4, 6):
        symbols(f"preset DUP{distance}", [("d", distance, 0)])
    symbols("preset tail copy", [("c", 3, 1)])
    symbols("leading zero length digits", [("r", 0, 260)] + [("r", 1, 4)] * 100 + [("r", 1, 0), ("r", 2, 0)], plaintext=b"\xFF\xFF")
    symbols("leading zero length digits then overflow", [("r", 0, 260)] + [("r", 1, 4)] * 100 + [("r", 1, 3)], length=2, error="length")
    for distance in (511, 512, 513):
        tokens = [("l", v, 0) for v in patterned(600)] + [("c", 5, distance)]
        symbols(f"tail distance {distance}", tokens)
    for length in (8, 9, 64, 65, 512, 513, 4096, 4097, 32768, 32769, 262144, 262145, 2097152, 2097153, 0xFFFFFF):
        symbols(f"no RLE alphabet length {length}", doubled_tokens(length))
    # Retain the entire minimum-size history, including a copy whose source
    # and destination each cross the physical ring boundary.
    tokens = [("l", v, 0) for v in patterned(20000)] + [("c", 100, 7133)]
    symbols("exact minimum history head distance", tokens, copy_limit=0)
    symbols("minimum history exceeded by one", tokens[:-1] + [("c", 100, 7134)], length=20100, copy_limit=0, error="history")
    symbols("copy reaches before preset", [("c", 3, 8000)], length=9000, error="history")
    symbols("copy exceeds declared length", [("c", 20, 1)], length=10, error="length")
    symbols("far minimum copy exceeds remaining output", [("l", 7, 0)] * 512 + [("c", 3, 512)], length=514, error="length")
    for name, intermediate in (
        ("empty expanded RLE", bytes([42])),
        ("escaped RLE literal", bytes([42, 42, 0])),
        ("RLE count boundaries", bytes([42, 42, 1, 9, 42, 255, 10, 12])),
        ("RLE expands beyond declared intermediate", bytes([42, 42, 255, 9])),
        ("RLE shrinks below intermediate", bytes([42]) + bytes([42, 0]) * 20),
    ):
        symbols(name, [("l", v, 0) for v in intermediate], rle=True)
    for name, data in (("missing RLE escape", b""), ("truncated RLE count", bytes([42, 42])), ("truncated RLE value", bytes([42, 42, 7]))):
        symbols(name, [("l", v, 0) for v in data], length=len(data), rle=True, error="run-length")
    return {"reference": URL, "referenceSha256": REFERENCE_HASH, "vectors": vectors}


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="mtx-reference-") as directory:
        result = generate(Path(directory))
    (ROOT / "mtx-vectors.json").write_text(json.dumps(result, indent=2) + "\n")
    print(f"Generated {len(result['vectors'])} vectors; valid outputs verified by the reference decoder")
