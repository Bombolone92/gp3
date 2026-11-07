"""Test the fixed global kernel against independent owned native geometry controls.

Capture inputs must match the retained source, manifest, metafile and PNG hashes.
Exit zero means completed evidence, not all-controls equivalence or app validation.
"""
import json
import math
from pathlib import Path
from io import BytesIO
import numpy as np
from PIL import Image
import probe_shadow_native_grid as p


def audit(capture, *, fine_bounds=False):
    folder=p.ROOT/'tests/fixtures/shadow-grid-boundary'
    ref=json.loads((folder/'native-metafile-grid.json').read_text())
    for name, field in [('source.docx', 'sourceSha256'), ('cases.json', 'casesSha256')]:
        if p.digest((folder/name).read_bytes()) != ref[field]:
            raise ValueError(f'Changed independent source: {name}')
    capture=Path(capture)
    if p.digest((capture/'capture.json').read_bytes()) != ref['captureSha256']:
        raise ValueError('Changed native capture manifest')
    if len(ref["cases"]) != 16:
        raise ValueError("Expected all sixteen independent controls")
    native=[]
    for c in ref['cases']:
        emf=capture/f"page-{c['page']}.emf"
        if p.digest(emf.read_bytes()) != c['emfSha256']:
            raise ValueError(f'Changed native metafile: {emf.name}')
        png=p.shadow_png(emf)
        if p.digest(png) != c['images'][0]['pngSha256']:
            raise ValueError(f'Changed native image: {emf.name}')
        native.append(np.asarray(Image.open(BytesIO(png)).convert('RGBA')))
    models=[]
    for geometry in ['source','native-shape']:
        for bits in [None,15]:
            rows=[]
            for c,a in zip(ref['cases'],native):
                shape=c if geometry=='source' else c['nativeShapeProperties']
                width,height=shape['widthPt'],shape['heightPt'];blur=c['blurPt']
                if fine_bounds:
                    # Separate hypothesis for the integer exported draw bounds;
                    # the epsilon only suppresses floating conversion noise at
                    # exact fine-grid integers. No native coordinate selection.
                    width=math.floor(width*600/72+1e-6)/(600/72)
                    height=math.ceil(height*600/72-1e-6)/(600/72)
                nx,ny=p.grid_size(width,blur),p.grid_size(height,blur)
                if a.shape!=(ny,nx,4):
                    rows.append(dict(case=c['name'],dimensionMatches=False));continue
                profiles=[]
                for size,extent in [(nx,width),(ny,height)]:
                    scale=size/(extent+2/(600/72)+2*blur);span=math.floor(extent*scale)
                    x=np.arange(size)-(size-1)/2
                    mask=np.maximum(0,np.minimum(x+.5,span/2)-np.maximum(x-.5,-span/2))
                    sigma=blur/3*scale;r=math.floor(3*sigma)
                    k=np.exp(-np.arange(-r,r+1,dtype=float)**2/(2*sigma*sigma));k/=k.sum()
                    if bits:
                        power=2**bits;k=np.floor(k*power+.5);k[r]+=power-k.sum();k/=power
                    profiles.append(np.convolve(mask,k,'same'))
                fx,fy=profiles;q=np.floor(fy[:,None]*np.floor(255*fx[None,:]+.5)+.5)
                delta=q-a[:,:,3];bad=delta!=0;witness=np.argwhere(bad)
                rows.append(dict(case=c['name'],dimensionMatches=True,wrongPixels=int(bad.sum()),maxAlphaError=int(np.abs(delta).max()),firstWitness=None if not len(witness) else dict(x=int(witness[0,1]),y=int(witness[0,0]),native=int(a[tuple(witness[0])][3]),predicted=int(q[tuple(witness[0])]))))
            models.append(dict(geometry=geometry,coefficientBits=bits,exactCases=sum(r.get('wrongPixels')==0 for r in rows),rows=rows))
    report=dict(scope='Independent rectangular/fractional/translated native alpha holdout; no app or original-template certification.',sourceSha256=ref['sourceSha256'],nativeReferenceSha256=p.digest((folder/'native-metafile-grid.json').read_bytes()),models=models)
    if fine_bounds:
        report['fineBoundsHypothesis'] = 'Floor source X and ceil source Y to the 600-DPI fine grid before grid/filter construction.'
    return report


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--fine-bounds', action='store_true')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Use a fresh destination; existing evidence is immutable')
    report = audit(args.capture, fine_bounds=args.fine_bounds)
    with args.output.open('x', encoding='utf8') as output:
        output.write(json.dumps(report, indent=2) + '\n')
    print(json.dumps([{k: v for k, v in model.items() if k != 'rows'} for model in report['models']]))


if __name__ == '__main__':
    main()
