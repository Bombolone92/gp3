"""Record independently observed reference ellipse screen crops and comparison regions.

Inputs are original JPEG screen captures, not browser-generated references.
Page origins are read from the visible paper edges. JPEG values are an error
reference, not a claim of exact native coverage or physical EMF geometry.
"""
import argparse, hashlib, json, math
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
FIXTURES=ROOT/'tests/fixtures/ellipse-native-geometry'

def record(captures):
    observations=[]
    for fixture,prefix in [('control',''),('holdout','holdout-'),('grouped','grouped-')]:
        source=FIXTURES/(fixture+'.docx')
        opened=captures/('ellipse-screen-'+('native' if fixture=='control' else fixture)+'-20261003.docx')
        assert opened.read_bytes()==source.read_bytes(), 'Opened copy differs from authored source'
        cases=json.loads((FIXTURES/('cases.json' if fixture=='control' else fixture+'-cases.json')).read_text())
        for zoom in ([75,100,200] if fixture=='grouped' else [100,200]):
            capture=captures/f'{prefix}screen-{zoom}.jpg'
            image=Image.open(capture);assert image.format=='JPEG'
            origin=(487,296) if zoom==75 else (272,202) if fixture=='control' and zoom==100 else (439,260) if zoom==100 else (247,116)
            scale=zoom/100
            crop=image.convert('RGB').crop((*origin,int(origin[0]+384*scale),int(origin[1]+288*scale)))
            name=f'native-screen-{fixture}-{zoom}.png';crop.save(FIXTURES/name)
            regions=[[math.floor(c['xEmu']/9525*scale)-3,math.floor(c['yEmu']/9525*scale)-2,
                      math.ceil(c['widthEmu']/9525*scale)+7,math.ceil(c['heightEmu']/9525*scale)+5] for c in cases]
            observations.append(dict(fixture=fixture,zoom=zoom,deviceScaleFactor=1,origin=origin,
                sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                captureSha256=hashlib.sha256(capture.read_bytes()).hexdigest(),captureFormat=image.format,
                captureSize=image.size,crop=name,cropSha256=hashlib.sha256((FIXTURES/name).read_bytes()).hexdigest(),regions=regions))
    report=dict(scope='Visible reference screen at stated zoom; black unfilled axis-aligned ellipses, including nonuniform groups. Paper-edge registration. Original JPEG noise remains. Padded regions can include neighboring outlines. Does not certify fill, rotation, fonts, or physical printer geometry.',
        provenance='Exact authored copies opened with the document-opening helper; unique matching visible reference titles and shape controls observed on screen. Visible Saved status; source copies byte-identical. ROT metadata was excluded because it referred to a different hidden reference instance.',observations=observations)
    (FIXTURES/'native-screen-reference.json').write_text(json.dumps(report,indent=2)+'\n')
    print(f'Recorded {len(observations)} native screen observations, {sum(len(o["regions"]) for o in observations)} regions')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('captures',type=Path)
    record(parser.parse_args().captures)
