"""Original read-only hypothesis audit; never installs, copies or edits fonts."""
import json,struct,math,hashlib
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
import argparse
parser=argparse.ArgumentParser(description='Read-only comparison of nine unhinted metric-gap hypotheses against 200 native script-position observations. No candidate is established rendering behavior.')
parser.add_argument('--font-directory',type=Path,default=Path('C:/Windows/Fonts'))
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
def verify(path,expected):
 actual=hashlib.sha256(path.read_bytes()).hexdigest()
 if actual!=expected:raise ValueError(f'Source hash mismatch: {path}')
refs={}
def reference(folder,name='reference.json'):
 path=repo/'tests/fixtures'/folder/name
 data=json.loads(path.read_text());refs[f'{folder}/{name}']=hashlib.sha256(path.read_bytes()).hexdigest()
 if folder=='script-position-metrics':
  for name,expected in data['hashes'].items():verify(path.parent/name,expected)
 else:
  verify(path.parent/('control.docx' if folder=='script-size' else 'controls.docx'),data['sourceSha256'])
  verify(path.parent/('native.pdf' if folder=='script-size' else 'controls-native.pdf'),data['pdfSha256'])
 return data
def metrics(path):
 b=path.read_bytes();tables={b[12+i*16:16+i*16]:struct.unpack_from('>I',b,20+i*16)[0] for i in range(struct.unpack_from('>H',b,4)[0])};o=tables[b'OS/2'];h=tables[b'hhea']
 return dict(em=struct.unpack_from('>H',b,tables[b'head']+18)[0],asc=struct.unpack_from('>H',b,o+74)[0],desc=struct.unpack_from('>H',b,o+76)[0],hhea=struct.unpack_from('>3h',b,h+4),script=struct.unpack_from('>8h',b,o+10))
rows=[]
r=reference('script-size')
for c in r['cases']:
 f=r['fonts'][c['family']][['regular','bold','italic'].index(c['face'])];p=args.font_directory/f['file'];verify(p,f['sha256']);m=metrics(p)
 for x in c['rows']:rows.append(dict(label=c['family']+'/'+c['face'],m=m,n=x['size'],small=round(x['nativeSize']*2)/2,sub=x['script']=='subscript',native=x['rise']))
r=reference('script-position-metrics','emf-reference.json')
for c in r['cases']:
 p=repo/'tests/fixtures/script-position-metrics'/(c['family'].replace(' ','')+'.ttf');verify(p,r['hashes'][p.name]);m=metrics(p)
 for x in c['rows']:rows.append(dict(label=c['family'],m=m,n=x['size'],small=round(-x['scriptHeight']*.12*2)/2,sub=x['script']=='subscript',native=x['risePt']))
r=reference('script-metric-controls')
for c in r['pages']:
 p=repo/'tests/fixtures/script-metric-controls'/c['font'];verify(p,c['fontSha256']);m=metrics(p)
 for s in ['superscript','subscript']:rows.append(dict(label=c['font'],m=m,n=20,small=round(c[s]['size']*2)/2,sub=s=='subscript',native=c[s]['rise']))
quant={'nearest':lambda x:math.floor(x+.5),'ceil':math.ceil,'floor':math.floor}
results=[]
for qname,q in quant.items():
 for ext in ['none','full','difference']:
  errors=[]
  for r in rows:
   m=r['m'];n=r['n'];small=r['small'];sub=r['sub'];scale=2/m['em'];fallback=math.floor(n*scale*m['script'][7]+.5)<math.floor(n/2)
   offset=math.floor((n*2*(.2 if sub else .4) if fallback else n*scale*m['script'][3 if sub else 7])+.5)
   metric=m['desc'] if sub else m['asc'];gap=q(metric*n*scale)-q(metric*small*scale)
   leading=max(0,sum([m['hhea'][0],-m['hhea'][1],m['hhea'][2]])-m['asc']-m['desc'])
   if not sub and ext!='none':gap+=q(leading*n*scale)-(q(leading*small*scale) if ext=='difference' else 0)
   predicted=min(offset,gap)/2*(-1 if sub else 1)
   errors.append(dict(label=r['label'],n=n,sub=sub,native=r['native'],predicted=predicted,error=abs(predicted-r['native'])))
  results.append(dict(quant=qname,external=ext,matches=sum(e['error']<.061 for e in errors),total=len(errors),maxError=max(e['error'] for e in errors),errors=[e for e in errors if e['error']>=.061]))
results.sort(key=lambda x:-x['matches'])
for result in results:
 result['failureCount']=len(result['errors'])
 # Retain the worst counterexamples, not a misleading prefix of font order.
 result['errors']=sorted(result['errors'],key=lambda error:-error['error'])[:12]
args.output.write_text(json.dumps({'referenceHashes':refs,'tolerancePt':.061,'method':'Half-point unhinted Windows ascent/descent differences, optionally including full or differential external leading; cap with rounded OS/2 recommendations or 40%/20% fallback. Native reduced sizes are rounded back to half points. These nine hypotheses are diagnostic, not renderer rules. All references/font inputs verified by SHA-256.', 'candidates':results},indent=2)+'\n')
print(json.dumps([{k:v for k,v in r.items() if k!='errors'} for r in results],indent=2));print(json.dumps(results[0]['errors'][:15],indent=2))
