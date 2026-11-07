"""Record reference screen ink independently of the existing metafile geometry.

Input JPEGs are original @oai/sky captures of the owned original control.
Page origins come from the visible paper edges, not from fitting table ink.
Only the interior table matrix is published; ribbon/status UI stays private.
"""
from pathlib import Path
from fractions import Fraction
import argparse, hashlib, json, math
from PIL import Image
import numpy as np

def sha(data): return hashlib.sha256(data).hexdigest()

def record(capture, output, zoom=100):
    assert zoom in [100,200]
    scale=zoom//100
    fixture = Path(__file__).resolve().parents[1] / 'tests/fixtures/border-axis-phase'
    source = (fixture/'control.docx').read_bytes()
    case_bytes = (fixture/'cases.json').read_bytes()
    native_bytes = (fixture/'reference.json').read_bytes()
    cases, native = json.loads(case_bytes), json.loads(native_bytes)
    metadata = json.loads((capture/('screen-state.json' if zoom==100 else 'screen-state-200.json')).read_text(encoding='utf-8-sig'))
    assert metadata['sourceSha256'].lower() == sha(source)
    assert metadata['savedAtCapture'] and metadata['contentCharacters'] == ''
    if zoom==100:
        assert metadata['savedBeforePaginationQuery'] and metadata['savedAfterPaginationQuery'] is False
        state=dict(savedBeforePaginationQuery=True,savedAfterPaginationQuery=False)
    else:
        assert metadata['savedAfterCapture'] and metadata['paginationQueryPerformed'] is False and metadata['sections']==8
        state=dict(savedAfterCapture=True,paginationQueryPerformed=False)
    assert metadata['pages'] == 8
    assert native['sourceSha256'] == sha(source) and native['casesSha256'] == sha(case_bytes)
    output.mkdir(parents=True, exist_ok=True)
    result = dict(sourceSha256=sha(source), casesSha256=sha(case_bytes), nativeReferenceSha256=sha(native_bytes),
        referenceBuild=metadata['referenceBuild'], savedAtCapture=True, **state, contentCharacters='', zoom=zoom, threshold=128,
        scope='96-DPI live native reference screen threshold bounds; independent of metafile projection. Not a full-page/color match.',
        cropOffset=[18*scale,21*scale], cropSize=[346*scale,237*scale], observations=[], nearestProjectionMatchingEdges=[0,0,0,0])
    # The paper outline spans 383 x 287 pixels at 100%; the nominal page is
    # 384 x 288. For pages 1..7 the visible lower outline identifies the top.
    # Page 8 has both outlines visible. Repositioning 5..7 avoids ribbon pixels.
    for page in range(1,9):
        clear = zoom==200 or 5 <= page <= 7
        file = f'page-{page}-'+('clear' if clear else 'thumbnails')+f'-{zoom}.jpg'
        origin = [614, 171 if clear else 425 if page == 8 else 158] if zoom==100 else [422,197 if page<=4 else 192]
        data = (capture/file).read_bytes()
        image = Image.open(capture/file)
        assert image.format == 'JPEG' and image.size == (1280,752)
        pixels = np.array(image.convert('RGB'))
        # Neutral gray outline at the expected lower edge; white inside and
        # gray workspace outside. This binds origin independently of ink.
        if zoom==100:
            bottom = origin[1]+287
            assert 185 <= pixels[bottom,800].min() <= pixels[bottom,800].max() <= 210
            assert pixels[bottom-2,800].min() >= 250 and pixels[bottom+2,800].max() < 245
        if zoom==200 or page == 8:
            assert 185 <= pixels[origin[1],800].min() <= pixels[origin[1],800].max() <= 210
            assert pixels[origin[1]+2,800].min() >= 250 and pixels[origin[1]-2,800].max() < 245
        x0,y0 = origin[0]+18*scale,origin[1]+21*scale
        crop = image.crop((x0,y0,x0+346*scale,y0+237*scale)).convert('RGB')
        crop_file = f'native-screen-page-{page}-{zoom}.png'
        crop.save(output/crop_file)
        a = np.array(crop)
        assert np.max(a.max(axis=2).astype(int)-a.min(axis=2)) <= 2
        rows = []
        for c,t in zip(cases[(page-1)*16:page*16],native['pages'][page-1]['tables']):
            x = (c['xTwips']-c['xPhaseTwips'])//15*scale-6*scale
            y = (c['yTwips']-c['yPhaseTwips'])//15*scale-3*scale
            w,h = 82*scale,math.ceil(c['heightTwips']/15*scale)+12*scale
            assert 0 <= x-18*scale and 0 <= y-21*scale and x+w <= 364*scale and y+h <= 258*scale
            p = a[y-21*scale:y-21*scale+h,x-18*scale:x-18*scale+w]
            yy,xx = np.where(p.max(axis=2)<128)
            assert len(xx)>0
            bounds = [int(xx.min()+x),int(yy.min()+y),int(xx.max()+x+1),int(yy.max()+y+1)]
            projected = [math.floor(Fraction(v*4*scale,25)+Fraction(1,2)) for v in t['bounds']]
            result['nearestProjectionMatchingEdges'] = [n+int(b==q) for n,b,q in zip(result['nearestProjectionMatchingEdges'],bounds,projected)]
            rows.append(dict(id=c['id'],region=[x,y,w,h],native=bounds,projected=projected))
        assert all(len({tuple(r['native'][i] for i in [1,3]) for r in rows[j:j+4]})==1 for j in range(0,16,4))
        result['observations'].append(dict(page=page,origin=origin,captureSha256=sha(data),
            crop=crop_file,cropSha256=sha((output/crop_file).read_bytes()),comparisons=rows))
    (output/('screen-reference.json' if zoom==100 else 'screen-reference-200.json')).write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(frames=128,nearestProjectionMatchingEdges=result['nearestProjectionMatchingEdges'])))

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('capture',type=Path)
    parser.add_argument('--zoom',type=int,choices=[100,200],default=100)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'tests/fixtures/border-axis-phase')
    args=parser.parse_args(); record(args.capture,args.output,args.zoom)
