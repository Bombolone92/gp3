"""Validate production pattern-resource exports with MIT psd-tools 1.23.0.

PHOTO_EDITOR_TEST_PORT=5275 PSD_PATTERN_EXPORT_DIRECTORY=/tmp/pattern-exports \
    npm run test:browser -- tests/browser/psd-patterns.spec.ts
python tests/fixtures/psd-patterns/validate.py /tmp/pattern-exports

The PSD/PSB suffix in each filename describes the input document version.
The production save API chooses the output file version independently.
"""
import sys
from pathlib import Path

from psd_tools import PSDImage
from psd_tools.constants import Tag
from psd_tools.psd.patterns import Patterns


def validate(directory):
    directory = Path(directory)
    fixtures = Path(__file__).parent
    keys = [Tag.PATTERNS1, Tag.PATTERNS2, Tag.PATTERNS3]
    labels = ["rgb-8-1", "rgb-16-2", "rgb-32-3"]
    expected = {
        f"{backend}-{depth}-{version}.psd"
        for backend in ("default", "WebGL")
        for depth in (8, 16, 32)
        for version in ("psd", "psb")
    }
    files = sorted(directory.glob("*.psd"))
    assert {f.name for f in files} == expected, "Expected all 12 production exports."
    records = planes = 0
    for filename in files:
        psd = PSDImage.open(filename)
        assert psd.depth == int(filename.stem.split("-")[-2]), filename
        assert psd.size == (7, 5), filename
        assert len(psd) == 1 and psd[0].name == "Editable source", filename
        assert psd[0].left == -1, filename
        for key, label in zip(keys, labels):
            exported = psd._record.layer_and_mask_information.tagged_blocks.get_data(key)
            original = Patterns.frombytes((fixtures / (label + ".bin")).read_bytes())
            assert exported.tobytes() == original.tobytes(), (filename, key)
            assert len(exported) == 1, (filename, key)
            a, b = exported[0], original[0]
            assert a.pattern_id == b.pattern_id and a.name == b.name, (filename, key)
            assert a.point == b.point and a.data.rectangle == b.data.rectangle, (filename, key)
            assert len(a.data.channels) == len(b.data.channels), (filename, key)
            records += 1
            for channel, source in zip(a.data.channels, b.data.channels):
                assert channel.is_written == source.is_written, (filename, key)
                if channel.is_written and channel.depth:
                    assert channel.depth == source.depth, (filename, key)
                    assert channel.rectangle == source.rectangle, (filename, key)
                    assert channel.get_data() == source.get_data(), (filename, key)
                    planes += 1
    print(f"Validated {len(files)} production exports, {records} native records and {planes} byte-exact planes.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: validate.py <production-export-directory>")
    validate(sys.argv[1])
