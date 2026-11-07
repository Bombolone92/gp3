"""Inspect hash-bound native shadow PNG alpha, without rendering or decoding fonts.

Axis asymmetry alone does not identify a kernel, pass order or rounding rule.
This is diagnostic evidence, not an equivalence test or a production correction.
"""
import argparse
import hashlib
from io import BytesIO
import json
from pathlib import Path
import struct
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'tests/fixtures/shadow-alpha-pipeline'


def shadow_png(path):
    data = path.read_bytes()
    pos = 0
    while pos < len(data):
        kind, size = struct.unpack_from('<II', data, pos)
        if size < 8 or pos + size > len(data):
            raise ValueError('Invalid EMF record')
        if kind == 70 and data[pos + 12:pos + 16] == b'EMF+':
            at = pos + 16
            while at < pos + size:
                typ, flags, length, count = struct.unpack_from('<HHII', data, at)
                if length < 12 or at + length > pos + size or count > length - 12:
                    raise ValueError('Invalid EMF+ record')
                payload = data[at + 12:at + 12 + count]
                if typ == 0x4008 and (flags >> 8) & 127 == 5:
                    if flags & 0x8000 or len(payload) < 36 or struct.unpack_from('<I', payload, 4)[0] != 1 or payload[28:36] != b'\x89PNG\r\n\x1a\n':
                        raise ValueError('Unexpected first native image object')
                    return payload[28:]
                at += length
        pos += size
    raise ValueError('Native shadow image absent')


def compare(alpha, width, height, transform):
    count, maximum, witness = 0, 0, None
    for y in range(height):
        for x in range(width):
            xx, yy = transform(x, y)
            a, b = alpha[y * width + x], alpha[yy * width + xx]
            if a != b:
                count += 1
                maximum = max(maximum, abs(a - b))
                if witness is None:
                    witness = dict(at=[x, y], other=[xx, yy], alpha=[a, b])
    return dict(differingPixels=count, maxAlphaDifference=maximum, firstWitness=witness)


def audit():
    path = FIXTURES / 'reference.json'
    reference = json.loads(path.read_text())
    for name, expected in reference['hashes'].items():
        if hashlib.sha256((FIXTURES / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f'Changed native evidence: {name}')
    rows, pairs = [], {}
    for page, case in enumerate(reference['cases'], 1):
        png = shadow_png(FIXTURES / f'shadow-color-{page}.emf')
        image = Image.open(BytesIO(png)).convert('RGBA')
        if hashlib.sha256(png).hexdigest() != case['images'][0]['pngSha256'] or list(image.size) != case['images'][0]['size']:
            raise ValueError('Shadow object does not match native reference')
        width, height = image.size
        if width != height:
            raise ValueError('This diagnostic requires square controls')
        alpha = image.getchannel('A').tobytes()
        key = (case['sourceAlpha'], case['blurPt'])
        pairs.setdefault(key, {})[case['color']] = alpha
        rows.append(dict(name=case['name'], size=[width, height],
            alphaSha256=hashlib.sha256(alpha).hexdigest(),
            transpose=compare(alpha, width, height, lambda x,y: (y,x)),
            horizontalReflection=compare(alpha, width, height, lambda x,y: (width-1-x,y)),
            verticalReflection=compare(alpha, width, height, lambda x,y: (x,height-1-y)),
            centerRow=list(alpha[(height//2)*width:(height//2+1)*width]),
            centerColumn=[alpha[y*width+width//2] for y in range(height)]))
    if len(rows) != 24 or len(pairs) != 12 or any(set(p) != {'FFFFFF','8040C0'} for p in pairs.values()):
        raise ValueError('Native control set incomplete')
    return dict(scope='Native EMF+ PNG alpha only; no kernel fit, rendered match, pass-order proof or corpus promotion.',
        nativeReference='tests/fixtures/shadow-alpha-pipeline/reference.json',
        nativeReferenceSha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        whitePurplePairs=[dict(sourceAlpha=k[0], blurPt=k[1], alphaBytesEqual=p['FFFFFF']==p['8040C0']) for k,p in pairs.items()],
        cases=rows)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    # Reject an occupied destination before reading any native capture.
    with args.output.open('x', encoding='utf-8') as output:
        report = audit()
        output.write(json.dumps(report, indent=2) + '\n')
    print(f"Inspected {len(report['cases'])} native alpha images; "
          f"{sum(p['alphaBytesEqual'] for p in report['whitePurplePairs'])}/12 white/purple alpha pairs equal.")
    for case in report['cases']:
        if case['name'].endswith('FFFFFF'):
            print(case['name'], 'transpose', case['transpose']['differingPixels'],
                  'reflections', case['horizontalReflection']['differingPixels'], case['verticalReflection']['differingPixels'])
