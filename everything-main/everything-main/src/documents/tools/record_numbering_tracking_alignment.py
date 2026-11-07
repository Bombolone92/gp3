"""Verify independent reference marker tracking/alignment controls."""
from pathlib import Path
import argparse,hashlib,json
from inspect_emf_text_records import inspect
from audit_font_wrap_device_origins import mapping
ROOT=Path(__file__).resolve().parents[1];FIXTURE=ROOT/'tests/fixtures/numbering-tracking-alignment'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def record(capture_root,fixture=FIXTURE):
 meta=json.loads((capture_root/'page-capture.json').read_text(encoding='utf-8-sig'))
 assert meta['sourceSha256']==sha(fixture/'control.docx') and meta['sourceUnchanged'] and meta['savedBefore'] and meta['savedAfter']
 cases=json.loads((fixture/'cases.json').read_text());assert len(cases)==108 and len(meta['captures'])==12
 output=[]
 for page,capture in enumerate(meta['captures']):
  assert capture['page']==page+1 and capture['file']==f'page-{page+1}.emf'
  assert (capture['widthPt'],capture['heightPt'])==(612,792)
  path=capture_root/capture['file'];assert sha(path)==capture['sha256'] and path.stat().st_size==capture['length']
  data=path.read_bytes();scale=mapping(data,width_pt=612,height_pt=792)
  rows=[r for r in inspect(data,include_italic=True) if r['text'].strip()]
  assert len(rows)==18
  for case in cases[page*9:page*9+9]:
   text=next(r for r in rows if r['text'].strip()==case['text'])
   markers=[r for r in rows if r['text'].strip()==case['label'] and r['logicalOrigin'][1]==text['logicalOrigin'][1]]
   assert len(markers)==1;marker=markers[0]
   for row,family in [(marker,case['family']),(text,'Arial')]:
    f=row['font'];assert f['face']==family and f['weight']==400 and not f['italic']
    assert f['height']==-100 and f['width']==f['escapement']==f['orientation']==0
    assert row['options']==4 and row['advanceDimensions']==1 and len(row['advances'])==len(row['text'])
   output.append(dict(**case,markerXPt=marker['logicalOrigin'][0]*scale,textXPt=text['logicalOrigin'][0]*scale,
    baselinePt=text['logicalOrigin'][1]*scale,markerAdvancePt=sum(marker['advances'])*scale,captureSha256=capture['sha256']))
 return dict(sourceSha256=sha(fixture/'control.docx'),casesSha256=sha(fixture/'cases.json'),
  captureMetadataSha256=sha(capture_root/'page-capture.json'),referenceBuild=meta['referenceBuild'],pages=12,readOnly=meta['readOnly'],
  sourceUnchanged=True,savedBefore=True,savedAfter=True,cases=output,scope='Bounded native GDI label/body origins, not raster or general font-equivalence proof.')

def compare(reference,viewer):
 assert viewer['pages']==12 and len(viewer['rows'])==108
 output=[]
 for case,row in zip(reference['cases'],viewer['rows'],strict=True):
  assert row['page']==case['page'] and row['text']==case['text'] and row['marker']['text']==case['label']
  output.append(dict(**case,markerErrorPt=row['marker']['x']-case['markerXPt'],textErrorPt=row['textX']-case['textXPt'],baselineErrorPt=row['baseline']-case['baselinePt']))
 return dict(cases=output,maxMarkerErrorPt=max(abs(r['markerErrorPt']) for r in output),maxTextErrorPt=max(abs(r['textErrorPt']) for r in output))

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('capture_root',type=Path);p.add_argument('--output',type=Path,required=True)
 p.add_argument('--viewer',type=Path);p.add_argument('--comparison',type=Path);p.add_argument('--fixture',type=Path,default=FIXTURE);a=p.parse_args()
 reference=record(a.capture_root,a.fixture);a.output.write_text(json.dumps(reference,indent=2)+'\n')
 if a.viewer:
  result=compare(reference,json.loads(a.viewer.read_text()))
  if a.comparison:a.comparison.write_text(json.dumps(result,indent=2)+'\n')
  print(json.dumps({k:v for k,v in result.items() if k!='cases'}))
  for row in sorted(result['cases'],key=lambda r:abs(r['markerErrorPt']),reverse=True)[:12]:print(row['family'],row['alignment'],row['trackingPt'],row['label'],row['markerErrorPt'],row['textErrorPt'])
