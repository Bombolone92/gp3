"""Compare the isolated origin-snapping candidate with authored native controls."""
from pathlib import Path
import argparse
import hashlib
import json
from record_rotated_screen_zooms import record as zooms,glyph_bounds,FOLDER
from record_rotated_live import record as original


def compare(folder):
    manifest=json.loads((folder/'manifest.json').read_text())
    native=zooms();prior=original()
    if manifest['sourceSha256']!=native['sourceSha256']:raise ValueError('Candidate uses a different source')
    references={o['zoomPercent']:o['screens'] for o in native['observations']};references[500]=prior['screens']
    rows=[]
    for row in manifest['rows']:
        zoom=row['zoomPercent'];scale=zoom//100
        if zoom not in (100,200,500) or row['pages']!=2 or len(row['pictures'])!=2:raise ValueError('Changed candidate cases')
        screens=[]
        for picture in row['pictures']:
            path=folder/picture['name']
            if path.resolve().parent!=folder.resolve():raise ValueError('Candidate image leaves output directory')
            if hashlib.sha256(path.read_bytes()).hexdigest()!=picture['sha256']:raise ValueError('Changed candidate image')
            screens.append(glyph_bounds(path,[30*scale,38*scale,110*scale,14*scale],[192*scale,240*scale]))
        ref=references[zoom]
        errors=[[v['bounds'][0]-vs[0]['bounds'][0]-(n['bounds'][0]-ns[0]['bounds'][0]) for v,n in zip(vs,ns)] for vs,ns in zip(screens,ref)]
        rows.append({'variant':row['variant'],'zoomPercent':zoom,
                     'translationX':[b['bounds'][0]-a['bounds'][0] for a,b in zip(*screens)],'relativeSpacingErrorsX':errors})
    if [(r['variant'],r['zoomPercent']) for r in rows]!=[(v,z) for v in ('current','snap-origin') for z in (100,200,500)]:raise ValueError('Changed candidate ordering/coverage')
    return {'engineRevision':manifest['engineRevision'],'sourceSha256':manifest['sourceSha256'],
            'candidate':manifest['candidate'],'manifestSha256':hashlib.sha256((folder/'manifest.json').read_bytes()).hexdigest(),
            'nativeReferenceHashes':native['hashes'],'original500ReferenceHashes':prior['hashes'],'rows':rows}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);args=parser.parse_args()
    result=compare(args.folder)
    (args.folder/'candidate-comparison.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result['rows'],indent=2))
