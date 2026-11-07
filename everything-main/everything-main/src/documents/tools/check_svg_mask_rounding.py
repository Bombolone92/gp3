"""Compare independent identity-filter pixels with the reference mask alpha.

This tests operation order only; intermediate pixels remain native inputs,
not values synthesized by the browser renderer.
"""
from pathlib import Path
import json, math

root = Path(__file__).resolve().parents[1] / 'tests/fixtures'
results = []
for suffix in ['', '-boundary']:
    paths = [root/('svg-mask-'+kind+suffix)/'metafile-reference.json' for kind in ['intermediate','quantization']]
    refs = [json.loads(p.read_text()) for p in paths]
    cases = json.loads((paths[0].parent/'cases.json').read_text())
    rows = []
    for case, raster, mask in zip(cases, refs[0]['images'], refs[1]['images']):
        pixel = raster['middleColumn'][raster['size'][1]//2]
        expected = mask['middleColumn'][mask['size'][1]//2][3]
        luminance = sum(v*w for v,w in zip(pixel,[.2126,.7152,.0722]))
        rounded = math.floor(luminance+.5)
        combined = math.floor(luminance*pixel[3]/255+.5)
        staged = math.floor(rounded*pixel[3]/255+.5)
        # Native alpha is an input here; this does not infer opacity parsing.
        alpha = pixel[3]
        reciprocal = math.floor(255*65536/alpha) if alpha else 0
        reconstructed = [math.floor(math.floor(c*alpha/255+.5)*reciprocal/65536) for c in bytes.fromhex(case['color'][1:])]
        rows.append(dict(case=case, pixel=pixel, reconstructedRgb=reconstructed, native=expected, combined=combined, staged=staged))
    results.append(dict(suffix=suffix, total=len(rows), combinedFailures=sum(r['combined']!=r['native'] for r in rows), stagedFailures=sum(r['staged']!=r['native'] for r in rows),
                        rgbFailures=sum(r['reconstructedRgb']!=r['pixel'][:3] for r in rows),
                        references={p.parent.name:dict(sourceSha256=ref['sourceSha256'], nativeSha256=ref['nativeSha256']) for p,ref in zip(paths,refs)}, rows=rows))
print(json.dumps(results, indent=2))
raise SystemExit(int(any(r['stagedFailures'] or r['rgbFailures'] for r in results)))
