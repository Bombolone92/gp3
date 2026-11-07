"""Bind independent reference page metafiles to the original table-axis controls."""
from pathlib import Path
from fractions import Fraction
import argparse, collections, gzip, hashlib, json, struct

def sha(data): return hashlib.sha256(data).hexdigest()
def rectangles(data):
    assert struct.unpack_from('<II', data) == (1,108)
    at, rects, counts = 0, [], collections.Counter()
    while at < len(data):
        kind,size=struct.unpack_from('<II',data,at)
        assert size>=8 and at+size<=len(data)
        counts[kind]+=1
        assert kind not in [35,36], 'Unexpected world transform'
        if kind==9: assert struct.unpack_from('<ii',data,at+8)==(2400,1800)
        if kind==76:
            assert size==100
            x,y,w,h,rop=struct.unpack_from('<iiiiI',data,at+24)
            assert rop==0xF00021 and w>0 and h>0
            assert struct.unpack_from('<IIII',data,at+84)==(0,0,0,0), 'Raster source data'
            rects.append([x,y,w,h])
        at+=size
    assert at==len(data) and len(rects)==192
    return [rects[i:i+12] for i in range(0,192,12)], dict(sorted(counts.items()))

def record(capture,folder):
    metadata=json.loads((capture/'page-capture.json').read_text(encoding='utf-8-sig'))
    source=(folder/'control.docx').read_bytes();cases=json.loads((folder/'cases.json').read_text())
    assert metadata['sourceSha256']==sha(source)
    assert metadata['sourceUnchanged'] and metadata['readOnly'] and metadata['savedAfter']
    assert len(metadata['captures'])==8 and len(cases)==128
    capture_metadata=(capture/'page-capture.json').read_bytes()
    (folder/'native-capture.json').write_bytes(capture_metadata)
    result=dict(referenceBuild=metadata['referenceBuild'],sourceSha256=sha(source),casesSha256=sha((folder/'cases.json').read_bytes()),
        captureSha256=sha(capture_metadata),scope='Native page-metafile integer PATCOPY rectangles, not screen ink or PDF geometry.',pages=[],models={})
    models={
        'absoluteFloor':lambda y,h,b:(y+h+b).__floor__(),
        'absoluteLowerBoundary':lambda y,h,b:(y+h+b).__ceil__()-1,
        'separateFloor':lambda y,h,b:y.__floor__()+h.__floor__()+b.__floor__(),
        'originFloorPlusExtentFloor':lambda y,h,b:y.__floor__()+(h+b).__floor__(),
        'originAndHeightFloorPlusBorder':lambda y,h,b:(y+h).__floor__()+b.__floor__(),
    }
    scores={name:dict(matching=0,total=128,counterexamples=[]) for name in models}
    for page in range(1,9):
        name=f'page-{page}.emf';data=(capture/name).read_bytes()
        native=metadata['captures'][page-1]
        assert native['page']==page and native['sha256']==sha(data)
        assert native['widthPt']==288 and native['heightPt']==216
        groups,counts=rectangles(data)
        zipped=gzip.compress(data,mtime=0);(folder/(name+'.gz')).write_bytes(zipped)
        rows=[]
        for c,group in zip(cases[(page-1)*16:page*16],groups):
            bounds=[min(r[0] for r in group),min(r[1] for r in group),max(r[0]+r[2] for r in group),max(r[1]+r[3] for r in group)]
            y=Fraction(c['yTwips']*5,12);height=Fraction(c['heightTwips']*5,12);border=Fraction(c['size']*25,24)
            assert bounds[1]==y.__floor__()
            rows.append(dict(id=c['id'],bounds=bounds,rectangles=group))
            for label,model in models.items():
                predicted=model(y,height,border)
                if predicted==bounds[3]:scores[label]['matching']+=1
                else:scores[label]['counterexamples'].append(dict(page=page,id=c['id'],predicted=predicted,native=bounds[3]))
        assert all(len({r['bounds'][1] for r in rows[i:i+4]})==1 and len({r['bounds'][3] for r in rows[i:i+4]})==1 for i in range(0,16,4))
        result['pages'].append(dict(page=page,file=name+'.gz',sha256=sha(zipped),rawSha256=sha(data),rawLength=len(data),
            widthPt=288,heightPt=216,windowExtent=[2400,1800],recordCounts=counts,tables=rows))
    result['models']=scores
    old_folder=Path(__file__).resolve().parents[1]/'tests/fixtures/border-phase'
    old_reference=old_folder/'native-height-reference.json'
    old=json.loads(old_reference.read_text())
    key=lambda c:tuple(c[n] for n in ['size','xTwips','yTwips','widthTwips','heightTwips'])
    captured={key(c):(p['page'],t['id'],t['bounds'][3]) for p in result['pages'] for t in p['tables'] for c in cases if c['page']==p['page'] and c['id']==t['id']}
    projection=[]
    for control in old['controls']:
        old_cases_path=old_folder/control['cases']
        assert sha((old_folder/control['source']).read_bytes())==control['sourceSha256']
        assert sha(old_cases_path.read_bytes())==control['casesSha256']
        old_cases=json.loads(old_cases_path.read_text())
        for observation in control['observations']:
            assert sha((old_folder/observation['crop']).read_bytes())==observation['cropSha256']
            for c,screen in zip(old_cases,observation['comparisons']):
                if key(c) not in captured:continue
                axis_page,axis_id,bottom=captured[key(c)]
                device=Fraction(bottom*4*observation['zoom'],2500)
                predicted=(device+Fraction(1,2)).__floor__()
                projection.append(dict(source=control['source'],id=c['id'],zoom=observation['zoom'],axisPage=axis_page,axisId=axis_id,nativeGridBottom=bottom,projected=predicted,screen=screen['native'][3]))
    assert len(projection)==16
    result['screenProjection']=dict(reference='border-phase/native-height-reference.json',referenceSha256=sha(old_reference.read_bytes()),matching=sum(r['projected']==r['screen'] for r in projection),total=len(projection),rows=projection,
        scope='Same table geometry declarations in older screen controls; surrounding table/page content differs. Nominal nearest-device projection is a rejected hypothesis, not an asserted reference display transform.')
    # Compact table/rectangle arrays retain all native integers without duplicating
    # source cases or filling the review record with thousands of vertical arrays.
    (folder/'reference.json').write_text(json.dumps(result,separators=(',',':'))+'\n',encoding='utf-8')
    print(json.dumps({name:v['matching'] for name,v in scores.items()},indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('capture',type=Path)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'tests/fixtures/border-axis-phase')
    args=parser.parse_args();record(args.capture,args.output)
