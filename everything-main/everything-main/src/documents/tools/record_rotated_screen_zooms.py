"""Bounded measurement of independently authored reference screen controls.

This reads screenshots and package XML, never font programs. It does not align
ink or fit offsets, and does not establish absolute page or glyph-shape matching.
"""
from pathlib import Path
from zipfile import ZipFile
import hashlib
import json
import numpy as np
from PIL import Image
from rotated_live_fixture import build

FOLDER=Path(__file__).resolve().parents[1]/'tests/fixtures/cell-text-direction/live-screen/zooms'


def glyph_bounds(path,crop,window_size,expected_count=6):
    with Image.open(path) as image:
        if list(image.size)!=window_size:raise ValueError('Changed native screen dimensions')
        pixels=np.asarray(image.convert('RGB'))
    x,y,w,h=crop
    if min(x,y)<0 or min(w,h)<=0 or x+w>pixels.shape[1] or y+h>pixels.shape[0]:
        raise ValueError('Invalid screen crop')
    mask=np.max(pixels[y:y+h,x:x+w],axis=2)<100
    columns=np.flatnonzero(mask.any(axis=0))
    groups=np.split(columns,np.flatnonzero(np.diff(columns)>1)+1)
    if (expected_count is not None and len(groups)!=expected_count) or any(len(g)==0 for g in groups):
        raise ValueError('Expected six isolated black glyphs' if expected_count==6 else 'Invalid isolated black glyphs')
    rows=[]
    for group in groups:
        ys,xs=np.where(mask[:,group[0]:group[-1]+1])
        rows.append({'bounds':[int(group[0]+xs.min()+x),int(ys.min()+y),int(group[0]+xs.max()+x),int(ys.max()+y)]})
    # Source tbRl lines advance right to left.
    return list(reversed(rows))


def record():
    capture=json.loads((FOLDER/'capture.json').read_text(encoding='utf-8'))
    if capture['source']!='../control.docx':raise ValueError('Changed bounded source path')
    source=FOLDER/capture['source']
    if hashlib.sha256(source.read_bytes()).hexdigest()!=capture['sourceSha256']:raise ValueError('Changed native source')
    with ZipFile(source) as package:
        if {name:package.read(name) for name in package.namelist()}!=build():raise ValueError('Source differs from independent construction')
    if not capture['sourceUnchanged'] or capture['windowSize']!=[946,536]:raise ValueError('Changed capture protocol')
    names={capture['source'],'capture.json'};observations=[]
    if [o['zoomPercent'] for o in capture['observations']]!=[100,200]:raise ValueError('Changed observed zoom coverage')
    for observation in capture['observations']:
        if [s['page'] for s in observation['screens']]!=[0,1]:raise ValueError('Changed paired page order')
        screens=[]
        for screen in observation['screens']:
            if screen['file'] not in {'native-both-100.png','native-0-200.png','native-1-200.png'}:raise ValueError('Changed bounded screenshot path')
            names.add(screen['file']);screens.append(glyph_bounds(FOLDER/screen['file'],screen['crop'],capture['windowSize']))
        observations.append({'zoomPercent':observation['zoomPercent'],'screens':screens,
                             'translationX':[b['bounds'][0]-a['bounds'][0] for a,b in zip(*screens)]})
    return {'sourceSha256':capture['sourceSha256'],'installedVersion':capture['installedVersion'],
            'hashes':{name:hashlib.sha256((FOLDER/name).read_bytes()).hexdigest() for name in sorted(names)},'observations':observations}


if __name__=='__main__':
    result=record();(FOLDER/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps([{k:v for k,v in observation.items() if k!='screens'} for observation in result['observations']]))
