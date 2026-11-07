"""Record native thin-border cross-sections; never infer them from app output."""
from pathlib import Path
from PIL import Image
import argparse
import gzip
import hashlib
import json
import struct
from record_border_inheritance import runs


def sha(data):
    return hashlib.sha256(data).hexdigest()


def record(capture, folder):
    metadata_bytes = (capture / 'capture.json').read_bytes()
    metadata = json.loads(metadata_bytes.decode('utf-8-sig'))
    assert metadata['savedBefore'] and metadata['savedAfter'] and metadata['closedUnchanged']
    assert metadata['characters'] == '' and metadata['tables'] == 17
    assert metadata['zoom'] == 100 and metadata['pages'] == 1
    assert [metadata['pageWidthPt'], metadata['pageHeightPt']] == [288, 432]
    source = (folder / 'control.docx').read_bytes()
    assert source == (capture / 'border-fine-phase-owned.docx').read_bytes()
    assert sha(source) == metadata['sourceSha256']
    raw = (capture / 'page.emf').read_bytes()
    rectangles, at, extent = [], 0, None
    while at < len(raw):
        kind, size = struct.unpack_from('<II', raw, at)
        assert size >= 8 and at + size <= len(raw)
        assert kind not in [35, 36, 77, 78, 79, 80, 81], 'Unexpected bitmap or transform'
        if kind == 9:
            extent = struct.unpack_from('<ii', raw, at + 8)
        if kind == 76:
            assert size == 100 and struct.unpack_from('<I', raw, at + 40)[0] == 0xF00021
            assert struct.unpack_from('<IIII', raw, at + 84) == (0, 0, 0, 0)
            rectangles.append(list(struct.unpack_from('<iiii', raw, at + 24)))
        at += size
    assert extent == (2400, 3600) and len(rectangles) == 204
    compressed = gzip.compress(raw, mtime=0)
    (folder / 'native.emf.gz').write_bytes(compressed)
    (folder / 'capture.json').write_bytes(metadata_bytes)
    screen = Image.open(capture / 'native-100.jpg').convert('RGB')
    origin = [439, 194]
    # Independent visible paper outline: 384px width; its bottom is clipped.
    edge_points = [(439, 204), (450, 194), (822, 200)]
    for point in edge_points:
        pixel = screen.getpixel(point)
        assert max(pixel) - min(pixel) <= 3 and 190 <= min(pixel) <= 210
    assert min(screen.getpixel((440, 204))) >= 248
    assert min(screen.getpixel((450, 195))) >= 248
    cases_bytes = (folder / 'cases.json').read_bytes()
    observations = []
    for case in json.loads(cases_bytes):
        x, y = case['xTwips'] / 15, case['yTwips'] / 15
        offset, size = [int(x) - 5, int(y) - 5], [75, 92]
        assert origin[1] + offset[1] + size[1] < 730, 'Crop outside visible page'
        ink = lambda x, y: max(screen.getpixel((origin[0] + x, origin[1] + y))) < 128
        vertical = runs([ink(offset[0] + dx, int(y) + 10) for dx in range(size[0])])
        horizontal = runs([ink(int(x) + 10, offset[1] + dy) for dy in range(size[1])])
        vertical = [[a + offset[0], b + offset[0]] for a, b in vertical]
        horizontal = [[a + offset[1], b + offset[1]] for a, b in horizontal]
        assert len(vertical) == len(horizontal) == 2
        assert all(b - a == 1 for a, b in vertical + horizontal)
        name = f'native-{case["id"]}-100.png'
        screen.crop((origin[0] + offset[0], origin[1] + offset[1], origin[0] + offset[0] + size[0], origin[1] + offset[1] + size[1])).save(folder / name)
        observations.append(dict(id=case['id'], vertical=vertical, horizontal=horizontal,
                                 crop=name, cropOffset=offset, cropSize=size, cropSha256=sha((folder / name).read_bytes())))
    result = dict(referenceBuild=metadata['referenceBuild'], zoom=100, origin=origin, threshold=128,
                  sourceSha256=sha(source), casesSha256=sha(cases_bytes), captureSha256=sha(metadata_bytes),
                  screenshotSha256=sha((capture / 'native-100.jpg').read_bytes()),
                  emfRawSha256=sha(raw), emfSha256=sha(compressed), rectangles=rectangles, observations=observations,
                  scope='17 thin-border cross-sections at 100%; not a full-page RGB match.',
                  limits=['Page bottom is outside the window; all measured tables are visible.',
                          'First crop includes table UI handles/caret; cross-sections avoid them.',
                          '600-DPI page metafile and 100% screen measurements are distinct references.'])
    (folder / 'reference.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(observations))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('capture', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'tests/fixtures/border-fine-phase')
    args = parser.parse_args()
    record(args.capture, args.output)
