"""Check a byte mask followed by a quantized premultiplied shadow brush.

Compatible pixels do not prove a blur kernel, mask values or the reference pass order.
Use coordinate-paired white/purple controls, not shuffled color histograms.
"""
import argparse
from collections import Counter
import hashlib
from io import BytesIO
import json
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from PIL import Image
from check_shadow_axis_symmetry import shadow_png
from check_shadow_channel_stages import F, nearest, premultiplied

ROOT = Path(__file__).resolve().parents[1]


def palette(color, opacity, source_alpha=255):
    alpha = nearest(F(255 * opacity, 100000))
    brush = [nearest(F(int(color[i:i+2], 16) * alpha, 255)) for i in (0,2,4)] + [alpha]
    states = {}
    for q in range(source_alpha + 1):
        values = tuple(nearest(F(v * q, 255)) for v in brush)
        states.setdefault(values, set()).add(q)
    return brush, states


def verified_reference(folder, name, key):
    path = folder / name
    reference = json.loads(path.read_text())
    for filename, expected in reference[key].items():
        if hashlib.sha256((folder / filename).read_bytes()).hexdigest() != expected:
            raise ValueError(f'Changed native evidence: {folder.name}/{filename}')
    return reference, hashlib.sha256(path.read_bytes()).hexdigest()


def audit():
    folder = ROOT / 'tests/fixtures/shadow-alpha-pipeline'
    reference, ref_hash = verified_reference(folder, 'reference.json', 'hashes')
    if len(reference['cases']) != 24:
        raise ValueError('Expected all 24 original controls')
    rows = []
    for index in range(0,24,2):
        white, purple = reference['cases'][index:index+2]
        if white['color'] != 'FFFFFF' or purple['color'] != '8040C0' or any(white[k] != purple[k] for k in ['sourceAlpha','blurPt','alpha']):
            raise ValueError('Native pair ordering or parameters changed')
        images = []
        for i, case in enumerate([white,purple],index+1):
            png = shadow_png(folder / f'shadow-color-{i}.emf')
            image = Image.open(BytesIO(png)).convert('RGBA')
            if hashlib.sha256(png).hexdigest() != case['images'][0]['pngSha256'] or list(image.size) != case['images'][0]['size']:
                raise ValueError('Native image identity changed')
            images.append(image)
        if images[0].size != images[1].size:
            raise ValueError('Native pair geometry differs')
        brushes, states = zip(*(palette(c['color'],c['alpha'],c['sourceAlpha']) for c in [white,purple]))
        pairs = Counter(zip(*(im.get_flattened_data() for im in images)))
        tested = incompatible = ambiguous = 0
        witness = None
        for (w,p), count in pairs.items():
            if not w[3] and not p[3]:
                continue  # Transparent RGB is outside this comparison.
            tested += count
            q = states[0].get(premultiplied(w),set()) & states[1].get(premultiplied(p),set())
            if not q:
                incompatible += count
                witness = witness or dict(white=list(w),purple=list(p),occurrences=count)
            elif len(q)>1:
                ambiguous += count
        rows.append(dict(sourceAlpha=white['sourceAlpha'],blurPt=white['blurPt'],size=list(images[0].size),
            brushes=brushes,testedPixels=tested,incompatiblePixels=incompatible,ambiguousMaskPixels=ambiguous,firstWitness=witness))
    # Independent textured/102%-scaled shadow, retained before this hypothesis.
    folder = ROOT / 'tests/fixtures/scaled-picture-shadows'
    _, texture_hash = verified_reference(folder,'metafile/reference.json','sha256')
    image = Image.open(folder/'metafile/shadow.png').convert('RGBA')
    with ZipFile(folder/'source.docx') as archive:
        document = ET.fromstring(archive.read('word/document.xml'))
    a = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
    shadows = list(document.iter(a+'outerShdw'))
    if len(shadows) != 14:
        raise ValueError('Independent texture control set changed')
    color = shadows[-1].find(a+'srgbClr')
    if color is None or color.find(a+'alpha') is None:
        raise ValueError('Independent texture has no direct RGB/alpha brush')
    rgb, opacity = color.get('val'), int(color.find(a+'alpha').get('val'))
    brush, states = palette(rgb,opacity)
    tested = incompatible = 0
    witness = None
    for rgba,count in Counter(image.get_flattened_data()).items():
        if not rgba[3]: continue
        tested += count
        if premultiplied(rgba) not in states:
            incompatible += count
            witness = witness or dict(rgba=list(rgba),occurrences=count)
    return dict(scope='Necessary mask/tint compatibility only. No rendered prediction, unique mask reconstruction, kernel or reference pass-order certification.',
        assumptions=['Brush opacity rounded to a byte; brush RGB premultiplied and rounded before masking.',
                     'Post-filter mask is a byte; each premultiplied channel product rounded to nearest.',
                     'Final RGB uses the previously tested truncated 16-bit reciprocal. These controls do not uniquely identify reciprocal precision.'],
        alphaReferenceSha256=ref_hash,textureReferenceSha256=texture_hash,pairs=rows,
        independentTexture=dict(size=list(image.size),sourceRgb=rgb,sourceOpacity=opacity,brush=brush,testedPixels=tested,incompatiblePixels=incompatible,firstWitness=witness))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True,type=Path)
    args = parser.parse_args()
    with args.output.open('x',encoding='utf-8') as output:
        result = audit()
        output.write(json.dumps(result,indent=2)+'\n')
    print('Paired native contradictions:',sum(row['incompatiblePixels'] for row in result['pairs']))
    print('Independent texture contradictions:',result['independentTexture']['incompatiblePixels'])
    # Success here means compatible, never a rendered equivalence pass.
    raise SystemExit(1 if any(row['incompatiblePixels'] for row in result['pairs']) or result['independentTexture']['incompatiblePixels'] else 0)
