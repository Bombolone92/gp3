"""Reject painting hypotheses against native authored relative glyph bounds."""
from pathlib import Path
import argparse,hashlib,json
from record_rotated_screen_metrics import record as metrics
from record_rotated_screen_zooms import record as zooms,glyph_bounds
from record_rotated_live import record as original

def compare(folder):
    manifest=json.loads((folder/'manifest.json').read_text())
    native500=original()
    refs={'live-screen':zooms(),'screen-metrics':metrics()};refs['live-screen']['observations'].append(native500)
    for source in manifest['sources']:
        if source['sha256']!=refs[source['name']]['sourceSha256']:raise ValueError('Changed hypothesis source')
    rows=[]
    for row in manifest['rows']:
        if row['source']=='screen-metrics' and row['zoomPercent']==100:continue
        reference=next(o for o in refs[row['source']]['observations'] if o['zoomPercent']==row['zoomPercent'])
        scale=row['zoomPercent']//100
        if len(row['pictures'])!=len(reference['screens']):raise ValueError('Changed page coverage')
        measured=[]
        for picture in row['pictures']:
            path=folder/picture['name']
            if path.resolve().parent!=folder.resolve() or hashlib.sha256(path.read_bytes()).hexdigest()!=picture['sha256']:raise ValueError('Changed hypothesis image')
            measured.append([g['bounds'] for g in glyph_bounds(path,[15*scale,38*scale,130*scale,20*scale],[192*scale,240*scale],expected_count=None)])
        if measured!=row['bounds']:raise ValueError('Recorded browser bounds differ from saved pixels')
        relative=lambda b:[[v-b[0][i%2] for i,v in enumerate(g)] for g in b]
        errors=[[[v-n for v,n in zip(vg,ng)] for vg,ng in zip(relative(vs),relative([n['bounds'] for n in ns]))] if len(vs)==len(ns)==6 else None for vs,ns in zip(measured,reference['screens'])]
        paired=[[b[0]-a[0] for a,b in zip(measured[i],measured[i+1])] if len(measured[i])==len(measured[i+1])==6 else None for i in range(0,len(measured),2)]
        nativePaired=[[b['bounds'][0]-a['bounds'][0] for a,b in zip(reference['screens'][i],reference['screens'][i+1])] for i in range(0,len(measured),2)]
        rows.append({'source':row['source'],'variant':row['variant'],'zoomPercent':row['zoomPercent'],
          'relativeBoundsErrors':errors,'pairedTranslationX':paired,'nativePairedTranslationX':nativePaired,
          'glyphIsolationValid':all(len(v)==6 for v in measured),
          'matchesRelativeBounds':all(page is not None and all(not any(g) for g in page) for page in errors),'matchesPairedTranslation':paired==nativePaired})
    variants=['current','raster-fractional','raster-nearest'] if manifest.get('experiment')=='quarter-turn-glyph-raster' else ['current','snap-origin','snap-origin-floor-twip','snap-origin-round-twip','snap-origin-ceil-twip']
    expected=[(v,s,z) for v in variants for s in ['live-screen','screen-metrics'] for z in [100,200,500] if s=='live-screen' or z!=100]
    # The wider source also renders 100%, but it has no native capture there.
    selected=[r for r in rows if r['source']=='live-screen' or r['zoomPercent']!=100]
    if [(r['variant'],r['source'],r['zoomPercent']) for r in selected]!=expected:raise ValueError('Changed hypothesis coverage')
    return {'engineRevision':manifest['engineRevision'],'manifestSha256':hashlib.sha256((folder/'manifest.json').read_bytes()).hexdigest(),
      'nativeHashes':{s:r['hashes'] for s,r in refs.items()},'original500Hashes':native500['hashes'],'rows':selected,
      'isolationFailures':[{'variant':r['variant'],'source':r['source'],'zoomPercent':r['zoomPercent'],'thresholdColumnGroups':[len(b) for b in r['bounds']]} for r in manifest['rows'] if r.get('glyphIsolationValid') is False],
      'scope':'Authored controls only. Comparison rejects hypotheses, not proof of general fidelity or an implementation recommendation. Native JPEGs supply bounded placement evidence, not exact glyph-shape equivalence.'}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);args=parser.parse_args()
    result=compare(args.folder);(args.folder/'comparison.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
    print(json.dumps([{k:v for k,v in r.items() if k not in ['relativeBoundsErrors','pairedTranslationX','nativePairedTranslationX']} for r in result['rows']],indent=2))
