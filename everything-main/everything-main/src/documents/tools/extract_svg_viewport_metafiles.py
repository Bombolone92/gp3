"""Extract native SVG metafiles from reference-application Range.EnhMetaFileBits captures.

Usage: python tools/extract_svg_viewport_metafiles.py <capture-directory>
MS-EMFPLUS 2.2.1.4 / 2.2.2.27 define the embedded image/metafile structures.
The input is generated from the original controls, not a document engine.
"""
from pathlib import Path
from hashlib import sha256
import struct
import sys
import json

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/svg-viewport-geometry'

def extract_all(data):
    """Return ordered nested metafile payloads, without interpreting font data.

    A page can repeat multiple vector assets under different outer object IDs.
    Compare these payloads rather than assuming the outer stream is byte-stable.
    """
    position = 0; images = []
    while position < len(data):
        kind, size = struct.unpack_from('<II', data, position)
        assert size >= 8 and position + size <= len(data)
        if kind == 70 and data[position+12:position+16] == b'EMF+':
            offset = position + 16
            while offset < position + size:
                kind, flags, length, count = struct.unpack_from('<HHII', data, offset)
                assert length >= 12 and offset + length <= position + size and count <= length - 12
                if kind == 0x4008 and (flags >> 8) & 127 == 5:
                    assert not flags & 0x8000, 'Continued image requires a separate capture reader'
                    _, image_type, metafile_type, metafile_size = struct.unpack_from('<IIII', data, offset+12)
                    assert image_type == 2 and metafile_type == 4
                    assert metafile_size <= count - 16
                    images.append(data[offset+28:offset+28+metafile_size])
                offset += length
        position += size
    return images


def extract(data):
    images = extract_all(data)
    assert len(images) == 1
    return images[0]

if __name__ == '__main__':
    records = []
    for name in ['small','medium','fractional','odd']:
        capture = (Path(sys.argv[1]) / f'{name}.emf').read_bytes()
        data = extract(capture)
        (OUT / f'{name}-native.emf').write_bytes(data)
        records.append(dict(name=name, captureSha256=sha256(capture).hexdigest(),
                            nestedSha256=sha256(data).hexdigest(),
                            bounds=struct.unpack_from('<4i',data,8),
                            frame=struct.unpack_from('<4i',data,24),
                            device=struct.unpack_from('<4i',data,72),
                            micrometers=struct.unpack_from('<2i',data,100)))
    (OUT / 'metafile-reference.json').write_text(json.dumps(records,indent=2)+'\n')
