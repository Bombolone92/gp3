"""Record observed reference display phases; does not infer a renderer correction."""
from pathlib import Path
from PIL import Image
import argparse, gzip, hashlib, json, struct
from record_border_inheritance import runs

def sha(data):
    return hashlib.sha256(data).hexdigest()

def record(capture, folder):
    data = (folder/'control.docx').read_bytes()
    assert data == (capture/'border-dense-phase-owned-20261002.docx').read_bytes(), 'Source changed'
    cases_bytes = (folder/'cases.json').read_bytes()
    assert cases_bytes == (capture/'cases.json').read_bytes(), 'Cases changed'
    cases = json.loads(cases_bytes)
    assert len(cases) == 60
    metadata_bytes = (capture/'capture.json').read_bytes()
    metadata = json.loads(metadata_bytes.decode('utf-8-sig'))
    assert metadata == dict(savedBefore=True, savedAfter=True, characters='', zoom=100,
                          pageWidthPt=288, pageHeightPt=216, referenceBuild='16.0.20326')
    raw = (capture/'page.emf').read_bytes()
    rectangles, at = [], 0
    while at < len(raw):
        kind, size = struct.unpack_from('<II', raw, at)
        assert size >= 8 and at+size <= len(raw)
        assert kind not in [35,36,77,78,79,80,81], 'Unexpected transform or bitmap'
        if kind == 9:
            assert struct.unpack_from('<ii', raw, at+8) == (2400,1800)
        if kind == 76:
            assert size == 100 and struct.unpack_from('<I', raw, at+40)[0] == 0xF00021
            assert struct.unpack_from('<IIII', raw, at+84) == (0,0,0,0)
            rectangles.append(list(struct.unpack_from('<iiii', raw, at+24)))
        at += size
    assert rectangles
    image = Image.open(capture/'native-100.jpg').convert('RGB')
    origin = (272,202)
    for point in [(282,202),(272,212)]:
        pixel = image.getpixel(point)
        assert max(pixel)-min(pixel) <= 3 and 160 <= min(pixel) <= 220
    assert min(image.getpixel((282,205))) >= 248
    paper = image.crop((272,202,656,490))
    ink = lambda x,y: max(paper.getpixel((x,y))) < 128
    observations = []
    for c in cases:
        x,y = int(c['xTwips']/15),int(c['yTwips']/15)
        vertical = [[a+x-3,b+x-3] for a,b in runs([ink(x-3+i,y+3) for i in range(72)])]
        horizontal = [[a+y-3,b+y-3] for a,b in runs([ink(x+10,y-3+i) for i in range(15)])]
        assert len(vertical) == len(horizontal) == 2, c
        assert all(b-a == 1 for a,b in vertical+horizontal), c
        observations.append(dict(id=c['id'],vertical=vertical,horizontal=horizontal))
    paper.save(folder/'native-100.png')
    zipped = gzip.compress(raw,mtime=0)
    (folder/'native.emf.gz').write_bytes(zipped)
    (folder/'capture.json').write_bytes(metadata_bytes)
    result = dict(sourceSha256=sha(data), casesSha256=sha(cases_bytes),
                  captureMetadataSha256=sha(metadata_bytes), captureSha256=sha((capture/'native-100.jpg').read_bytes()),
                  cropSha256=sha((folder/'native-100.png').read_bytes()), emfSha256=sha(zipped), emfRawSha256=sha(raw),
                  referenceBuild=metadata['referenceBuild'], zoom=100, origin=list(origin), threshold=128,
                  rectangles=rectangles, observations=observations,
                  scope='Native cross-sections of 60 thin table frames at all fifteen Y phases and four X phases.',
                  limits=['Only 100% zoom observed.','Paper crop includes caret/handles; measured cross-sections avoid them.',
                          'JPEG capture classified at threshold 128; no full RGB equivalence claim.',
                          'Metafile rectangles describe print geometry, not display rasterization.'])
    (folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(tables=len(observations),rectangles=len(rectangles))))

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('capture',type=Path)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'tests/fixtures/border-dense-phase')
    args=parser.parse_args()
    record(args.capture,args.output)
