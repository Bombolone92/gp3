"""Measure bounded glyph placement in original authored native reference controls.

No font programs, ink alignment or glyph-shape comparison is performed.
"""
from pathlib import Path
from zipfile import ZipFile
import hashlib,json
from rotated_screen_metrics_fixture import build
from record_rotated_screen_zooms import glyph_bounds

FOLDER=Path(__file__).resolve().parents[1]/'tests/fixtures/cell-text-direction/screen-metrics'

def record():
    capture=json.loads((FOLDER/'capture.json').read_text(encoding='utf8'))
    source=FOLDER/'control.docx';parts,cases=build()
    with ZipFile(source) as package:
        if {n:package.read(n) for n in package.namelist()}!=parts:raise ValueError('Changed independent control')
    if json.loads((FOLDER/'cases.json').read_text())!=cases:raise ValueError('Changed control cases')
    sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    if sha(source)!=capture['sourceSha256'] or not capture['sourceUnchanged']:raise ValueError('Native source changed')
    if capture['windowSize']!=[946,536]:raise ValueError('Native window changed')
    if [o['zoomPercent'] for o in capture['observations']]!=[200,500]:raise ValueError('Changed zoom coverage')
    hashes={n:sha(FOLDER/n) for n in ['control.docx','cases.json','capture.json']};observations=[]
    for observation in capture['observations']:
        if [s['page'] for s in observation['screens']]!=list(range(1,7)):raise ValueError('Incomplete native page coverage')
        screens=[]
        for screen in observation['screens']:
            name=f"native-page{screen['page']}-{observation['zoomPercent']}.jpg"
            if screen['file']!=name:raise ValueError('Changed bounded screenshot path')
            hashes[name]=sha(FOLDER/name)
            try:screens.append(glyph_bounds(FOLDER/name,screen['crop'],capture['windowSize']))
            except ValueError as error:raise ValueError(f'{name}: {error}') from error
        observations.append({'zoomPercent':observation['zoomPercent'],'screens':screens,
          'pairedTranslationX':[[b['bounds'][0]-a['bounds'][0] for a,b in zip(screens[i],screens[i+1])] for i in [0,2,4]]})
    return {'sourceSha256':sha(source),'installedVersion':capture['installedVersion'],'hashes':hashes,
      'scope':'Relative black threshold bounds only; JPEG capture is not a pixel-shape oracle. No absolute page alignment inferred. Status-bar pagination was stale; page identity was verified by authored visible labels.',
      'observations':observations}

if __name__=='__main__':
    result=record();(FOLDER/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
    print(json.dumps([{k:v for k,v in row.items() if k!='screens'} for row in result['observations']]))
