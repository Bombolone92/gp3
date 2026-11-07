"""Bind observed reference zoom captures using inclusive paper edges and overlap."""
from pathlib import Path
from PIL import Image
import argparse, json, math
from record_border_dense_phase import sha
from record_border_inheritance import runs

def record(capture, folder, zoom=200):
    config={200:dict(x=80,top=213,bottom=478,width=768,height=576,start=277,topSize=299,bottomSize=299,topRows=8),
            175:dict(x=128,top=209,bottom=511,width=672,height=504,start=172,topSize=303,bottomSize=332,topRows=9)}[zoom]
    scale=zoom/100
    original=(folder/'control.docx').read_bytes()
    assert original==(capture/'border-dense-phase-owned-20261002.docx').read_bytes(), 'Owned source changed'
    metadata_bytes=(capture/f'capture-{zoom}.json').read_bytes()
    metadata=json.loads(metadata_bytes.decode('utf-8-sig'))
    assert metadata==dict(savedAfter=True,characters='',zoom=zoom,pageWidthPt=288,pageHeightPt=216,referenceBuild='16.0.20326')
    cases_bytes=(folder/'cases.json').read_bytes()
    cases=json.loads(cases_bytes)
    images={name:Image.open(capture/f'native-{zoom}-{name}.jpg').convert('RGB') for name in ['top','bottom']}
    # Native paper outlines are inclusive; derive bottom origin from the
    # observed bottom edge minus the scaled page height plus one.
    for name,image in images.items():
        assert image.size==(946,536)
        for x in [config['x'],config['x']+config['width']-1]:
            p=image.getpixel((x,300));assert max(p)-min(p)<=3 and 160<=min(p)<=220
        for x in [config['x']+1,config['x']+config['width']-2]:assert min(image.getpixel((x,300)))>=248
        edge=config[name]
        p=image.getpixel((config['x']+20,edge));assert max(p)-min(p)<=3 and 160<=min(p)<=220
        assert min(image.getpixel((config['x']+20,edge+(1 if name=='top' else -1))))>=248
        assert max(image.getpixel((config['x']+20,edge+(-1 if name=='top' else 1))))<=245
    origins={'top':[config['x'],config['top']],'bottom':[config['x'],config['bottom']-config['height']+1]}
    ink=lambda name,x,y:max(images[name].getpixel((origins[name][0]+x,origins[name][1]+y)))<128
    # Every non-outline pixel in the shared band must agree. This
    # independently guards the scroll translation, not just table positions.
    for y in range(config['start'],config['topSize']):
        for x in range(1,config['width']-1):assert ink('top',x,y)==ink('bottom',x,y), (x,y)
    crops=[]
    for name in ['top','bottom']:
        offset=[0,0 if name=='top' else config['start']];origin=origins[name]
        height=config[name+'Size'];file=f'native-{zoom}-{name}.png'
        images[name].crop((origin[0],origin[1]+offset[1],origin[0]+config['width'],origin[1]+offset[1]+height)).save(folder/file)
        crops.append(dict(name=name,origin=origin,crop=file,cropOffset=offset,cropSize=[config['width'],height],
                          cropSha256=sha((folder/file).read_bytes()),captureSha256=sha((capture/f'native-{zoom}-{name}.jpg').read_bytes())))
    observations=[]
    for c in cases:
        x,y=int(c['xTwips']*scale/15),int(c['yTwips']*scale/15)
        name='top' if c['yPhaseTwips']<config['topRows'] else 'bottom'
        vertical=[[a+x-4,b+x-4] for a,b in runs([ink(name,x-4+i,y+5) for i in range(math.ceil(64*scale)+10)])]
        horizontal=[[a+y-3,b+y-3] for a,b in runs([ink(name,x+20,y-3+i) for i in range(math.ceil(8*scale)+7)])]
        assert len(vertical)==len(horizontal)==2, c
        assert all(b-a==1 for a,b in vertical+horizontal), c
        observations.append(dict(id=c['id'],crop=name,vertical=vertical,horizontal=horizontal))
    (folder/f'capture-{zoom}.json').write_bytes(metadata_bytes)
    reference=dict(sourceSha256=sha(original),casesSha256=sha(cases_bytes),captureMetadataSha256=sha(metadata_bytes),
                   referenceBuild=metadata['referenceBuild'],zoom=zoom,threshold=128,pageSize=[config['width'],config['height']],crops=crops,
                   overlap=dict(offset=[1,config['start']],size=[config['width']-2,config['topSize']-config['start']],differingPixels=0),observations=observations,
                   scope=f'Cross-sections of sixty thin frames at {zoom}%, using two observed overlapping viewports.',
                   limits=['JPEG captures classified at threshold 128; no full RGB match claim.',
                           'Paper outline and native caret/handles remain in crops; measured cross-sections avoid them.',
                           'Only exact owned empty source closed without saving; post-close source bytes match original.'])
    (folder/f'reference-{zoom}.json').write_text(json.dumps(reference,indent=2)+'\n')
    print(json.dumps(dict(tables=len(observations),overlapPixels=(config['width']-2)*(config['topSize']-config['start']),overlapDifferences=0)))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('capture',type=Path)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'tests/fixtures/border-dense-phase')
    parser.add_argument('--zoom',type=int,choices=[175,200],default=200)
    args=parser.parse_args();record(args.capture,args.output,args.zoom)
