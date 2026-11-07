"""Bounded repeat audit of one native reference view; never access font programs."""
from pathlib import Path
from zipfile import ZipFile
import hashlib,json
from rotated_screen_metrics_fixture import build
from record_rotated_screen_zooms import glyph_bounds

FOLDER=Path(__file__).resolve().parents[1]/'tests/fixtures/cell-text-direction/screen-metrics/repeats'
def record():
    capture=json.loads((FOLDER/'capture.json').read_text(encoding='utf8'))
    if capture['source']!='../control.docx' or capture['page']!=1 or capture['zoomPercent']!=200:raise ValueError('Changed bounded repeat scope')
    source=FOLDER/capture['source'];sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    parts,_=build()
    with ZipFile(source) as package:
        if {n:package.read(n) for n in package.namelist()}!=parts:raise ValueError('Changed independent source')
    if not capture['sourceUnchanged'] or sha(source)!=capture['sourceSha256']:raise ValueError('Changed native source')
    if capture['windowSize']!=[946,536]:raise ValueError('Changed native window')
    if [f['file'] for f in capture['frames']]!=['native-page1-200-first.jpg','native-page1-200-second.jpg']:raise ValueError('Changed repeat sequence')
    prior=json.loads((FOLDER/'../reference.json').read_text(encoding='utf8'))
    expected=next(o for o in prior['observations'] if o['zoomPercent']==200)['screens'][0]
    frames=[];hashes={n:sha(FOLDER/n) for n in ['capture.json','../control.docx','../reference.json']}
    for frame in capture['frames']:
        name=frame['file'];hashes[name]=sha(FOLDER/name)
        bounds=glyph_bounds(FOLDER/name,frame['crop'],capture['windowSize'])
        frames.append({'file':name,'glyphs':bounds,'matchesPriorBounds':bounds==expected})
    return {'hashes':hashes,'frames':frames,'repeatedBoundsIdentical':frames[0]['glyphs']==frames[1]['glyphs'],
      'scope':'One page at 200% only. No repeated 500% view obtained. Threshold placement, not exact glyph shape or global native stability.'}
if __name__=='__main__':
    result=record();(FOLDER/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
    if not result['repeatedBoundsIdentical'] or not all(f['matchesPriorBounds'] for f in result['frames']):raise ValueError('Repeat differs from retained native bounds')
    print('Two repeated 200% frames retain all six prior native glyph bounds.')
