"""Independently decode editable production exports with MIT psd-tools 1.23.0.

Run after tests/browser/vector-patterns.spec.ts:
python tests/fixtures/psd-patterns/validate-editable.py /tmp/photo-editor-native-pattern-exports /tmp/photo-editor-native-pattern-copy-exports
"""
from pathlib import Path
import sys
import warnings
from psd_tools import PSDImage
from psd_tools.constants import Tag
from psd_tools.psd.patterns import Patterns

root = Path(sys.argv[1])
expected = {f"{backend}/{depth}-{version}.psd" for backend in ("default", "WebGL")
            for depth in (8, 16, 32) for version in ("psd", "psb")}
files = sorted(root.rglob("*.psd"))
assert {str(p.relative_to(root)) for p in files} == expected
for path in files:
    depth = int(path.stem.split("-")[0])
    d = (8, 16, 32).index(depth)
    with warnings.catch_warnings(record=True) as diagnostics:
        warnings.simplefilter("always")
        psd = PSDImage.open(path)
    assert not diagnostics, (path, diagnostics)
    assert psd.depth == depth and psd.size == (17 + 4*d, 11 + 2*d)
    assert len(psd) == 1 and psd[0].name == "Editable pattern" and psd[0].kind == "shape"
    blocks = psd[0]._record.tagged_blocks
    desc = blocks.get_data(Tag.PATTERN_FILL_SETTING)
    assert set(desc) == {b"Ptrn", b"phase"}, (path, desc)
    assert desc[b"Ptrn"][b"Idnt"].value.rstrip("\0") == f"rgb-{depth}-3"
    assert desc[b"Ptrn"][b"Nm  "].value.rstrip("\0") == f"Independent rgb-{depth}-3 Ω"
    assert desc[b"phase"][b"Hrzn"].value == -2.5000001 + d/8 + 1.25
    assert desc[b"phase"][b"Vrtc"].value == 1.375 - d/4 - .875
    assert list(blocks.get_data(Tag.REFERENCE_POINT)) == [5.75, -3.125]
    assert blocks.get_data(Tag.VECTOR_MASK_SETTING1) is not None
    patterns = psd._record.layer_and_mask_information.tagged_blocks.get_data(Tag.PATTERNS1)
    original = Patterns.frombytes((Path(__file__).parent / f"rgb-{depth}-3.bin").read_bytes())
    assert patterns.tobytes() == original.tobytes(), path
    for actual, source in zip(patterns[0].data.channels, original[0].data.channels):
        assert actual.is_written == source.is_written
        if actual.is_written and actual.depth:
            assert actual.depth == source.depth and actual.rectangle == source.rectangle
            assert actual.get_data() == source.get_data()
print(f"Verified {len(files)} editable pattern exports: descriptors, reference points, geometry, native resource records and planes.")
if len(sys.argv) > 2:
    copies = sorted(Path(sys.argv[2]).glob("*.psd"))
    assert {p.name for p in copies} == {"default.psd", "WebGL.psd"}
    for path in copies:
        with warnings.catch_warnings(record=True) as diagnostics:
            warnings.simplefilter("always")
            psd = PSDImage.open(path)
        assert not diagnostics, (path, diagnostics)
        assert psd.depth == 32 and psd.size == (19, 13) and len(psd) == 2
        patterns = psd._record.layer_and_mask_information.tagged_blocks.get_data(Tag.PATTERNS3)
        assert [p.pattern_id for p in patterns] == ["rgb-8-3", "gray"]
        for index, label in enumerate(("rgb-8-3", "gray")):
            original = Patterns.frombytes((Path(__file__).parent / (label + ".bin")).read_bytes())
            assert patterns[index].tobytes() == original[0].tobytes(), (path, label)
            layer = psd[index]
            assert layer.kind == "shape"
            desc = layer._record.tagged_blocks.get_data(Tag.VECTOR_STROKE_CONTENT_DATA)
            assert desc.key == b"PtFl"
            assert desc[b"Ptrn"][b"Idnt"].value.rstrip("\0") == label
            assert layer.opacity == 160
            assert layer._record.mask_data.parameters.user_mask_density == 192
    print(f"Verified {len(copies)} copied-material exports: two editable shapes, one combined Pat3 block and exact independent resources.")
