"""Audit complete border-frame regions; preserve exact native crops and explicit fresh first-frame captures."""
from pathlib import Path
from PIL import Image
import numpy as np, json, hashlib, sys

root=Path(sys.argv[1])
output=Path(sys.argv[2])
fixtures=Path('tests/fixtures')
sha=lambda data:hashlib.sha256(data).hexdigest()
clean_ref=json.loads((fixtures/'border-phase/native-clean-corners-reference.json').read_bytes())
edge_ref=json.loads(Path('tests/fixtures/measurements/border-leading-candidate.json').read_bytes())
for entry in edge_ref['entries']:assert sha(Path(entry['source']).read_bytes())==entry['sourceSha256']
entries=[]
for name in ['control','holdout','reordered','heights-thin','heights-wide','filled','borderless']:
    folder=fixtures/'border-phase'
    if name in ['filled','borderless']:
        observations=next(c for c in json.loads((folder/'native-fill-reference.json').read_bytes())['controls'] if c['source']==name+'.docx')['observations']
    elif name.startswith('heights-'):
        observations=next(c for c in json.loads((folder/'native-height-reference.json').read_bytes())['controls'] if c['source']==name+'.docx')['observations']
    else:
        observations=json.loads((folder/('native-'+('' if name=='control' else name+'-')+'reference.json')).read_bytes())['observations']
    if name=='control':observations+=json.loads((folder/'native-intermediate-reference.json').read_bytes())['observations']
    for o in observations:entries.append(dict(name=name,folder='border-phase',zoom=o['zoom'],page=1,crop=o['crop'],cropSha256=o['cropSha256'],offset=[0,0],regions=o['regions']))
for zoom in [100,200]:
    r=json.loads((fixtures/'border-axis-phase'/('screen-reference'+('' if zoom==100 else '-200')+'.json')).read_bytes())
    for o in r['observations']:entries.append(dict(name='control',folder='border-axis-phase',zoom=zoom,page=o['page'],crop=o['crop'],cropSha256=o['cropSha256'],offset=r['cropOffset'],regions=[c['region'] for c in o['comparisons']]))
results=[]
for e in entries:
    native_file=fixtures/e['folder']/e['crop'];assert sha(native_file.read_bytes())==e['cropSha256']
    native=np.array(Image.open(native_file).convert('RGB'))
    actual={mode:np.array(Image.open(root/f'{mode}-{e["folder"]}-{e["name"]}-{e["zoom"]}-p{e["page"]}.png').convert('RGB')) for mode in ['baseline','candidate']}
    ox,oy=e['offset'];metrics={}
    predicates={'black':lambda a:np.max(a,axis=2)<128}
    if e['name'] in ['filled','borderless']:
        predicates['red']=lambda a:(a[:,:,0]*.299+a[:,:,1]*.587+a[:,:,2]*.114<166)&(a[:,:,0]>128)&(a[:,:,0].astype(int)>a[:,:,1].astype(int)+32)&(a[:,:,0].astype(int)>a[:,:,2].astype(int)+32)
    for kind,predicate in predicates.items():
        differing={mode:0 for mode in actual};worse=0;samples=[];pixels=0
        for region_id,(x,y,w,h) in enumerate(e['regions'],1):
            assert x>=ox and y>=oy and x+w<=ox+native.shape[1] and y+h<=oy+native.shape[0],(e,region_id)
            region_native=native[y-oy:y-oy+h,x-ox:x-ox+w]
            refreshed=next((o for o in clean_ref['observations'] if e['folder']=='border-phase' and o['source']==e['name']+'.docx' and o['zoom']==e['zoom'] and region_id==1),None)
            if refreshed:
                assert refreshed['region']==[x,y,w,h]
                refreshed_file=fixtures/e['folder']/refreshed['crop'];assert sha(refreshed_file.read_bytes())==refreshed['cropSha256']
                region_native=np.array(Image.open(refreshed_file).convert('RGB'))
            n=predicate(region_native);m={mode:predicate(a[y:y+h,x:x+w]) for mode,a in actual.items()}
            assert all(a.shape==n.shape for a in m.values());pixels+=w*h
            for mode in actual:differing[mode]+=int(np.count_nonzero(n!=m[mode]))
            bad=(n==m['baseline'])&(n!=m['candidate']);worse+=int(np.count_nonzero(bad))
            for dy,dx in np.argwhere(bad)[:10-len(samples)]:samples.append(dict(region=region_id,x=int(x+dx),y=int(y+dy)))
        metrics[kind]=dict(pixels=pixels,differing=differing,worse=worse,samples=samples)
    results.append(dict(nativeCropSha256=e['cropSha256'],rasterSha256={mode:sha((root/f'{mode}-{e["folder"]}-{e["name"]}-{e["zoom"]}-p{e["page"]}.png').read_bytes()) for mode in actual},source=f'tests/fixtures/{e["folder"]}/{e["name"]}.docx',zoom=e['zoom'],page=e['page'],regions=len(e['regions']),metrics=metrics))
baseline=Path('src/engine/border-device-layout.js').read_text()
assert sha(baseline.replace('\r\n','\n').encode())==edge_ref['baselineCanonicalSha256']
summary=dict(status='rejected',candidateCanonicalSha256=sha((root/'candidate.js').read_text().replace('\r\n','\n').encode()),baselineBorderCanonicalSha256=edge_ref['baselineCanonicalSha256'],baselineEditorCanonicalSha256=sha(Path('src/engine/canvas-editor.js').read_text().replace('\r\n','\n').encode()),cleanReferenceSha256=sha((fixtures/'border-phase/native-clean-corners-reference.json').read_bytes()),edgeEvidenceCanonicalSha256=sha(Path('tests/fixtures/measurements/border-leading-candidate.json').read_text().replace('\r\n','\n').encode()),edgeSummary=json.loads((root/'summary.json').read_bytes()),regions=sum(e['regions'] for e in results),observations=results,
             blackWorse=sum(e['metrics']['black']['worse'] for e in results),
             redWorse=sum(e['metrics'].get('red',{}).get('worse',0) for e in results))
output.write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(dict(regions=summary['regions'],blackWorse=summary['blackWorse'],redWorse=summary['redWorse'])))
