"""Diagnostic position model. Native reduced sizes are supplied, not predicted.

Static-face observations constrain metric rounding and device-bound caps.
This does not establish script sizing validation, variable-instance metrics,
other output devices or a generally correct production positioning algorithm.
"""
from pathlib import Path
import sys,json,math,hashlib
from fontTools.ttLib import TTFont
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
def check(folder,data):
 for name,digest in data.get('hashes',{}).items():assert hashlib.sha256((folder/name).read_bytes()).hexdigest()==digest
import argparse
parser=argparse.ArgumentParser(description='Diagnostic device-bound script positions; native reduced sizes are inputs, not predictions.')
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
rows=[]
folder=ROOT/'tests/fixtures/script-size';ref=json.loads((folder/'reference.json').read_text())
assert hashlib.sha256((folder/'control.docx').read_bytes()).hexdigest()==ref['sourceSha256']
assert hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest()==ref['pdfSha256']
for c in ref['cases']:
 font=ref['fonts'][c['family']][['regular','bold','italic'].index(c['face'])]
 path=Path('C:/Windows/Fonts')/font['file'];assert hashlib.sha256(path.read_bytes()).hexdigest()==font['sha256']
 for r in c['rows']:rows.append(dict(label=c['family']+'/'+c['face'],path=path,size=r['size'],small=round(r['nativeSize']*2)/2,sub=r['script']=='subscript',native=r['rise']))
for name,filename in [('script-position-metrics','emf-reference.json'),('script-vdmx-position','reference.json'),('script-vdmx-ppem','reference.json'),('script-device-caps','reference.json'),('script-size-offset','reference.json'),('script-sub-offset','reference.json'),('script-sub-offset-threshold','reference.json')]:
 folder=ROOT/'tests/fixtures'/name;ref=json.loads((folder/filename).read_text());check(folder,ref)
 for c in ref['cases']:
  for r in c['rows']:rows.append(dict(label=c['family'],path=folder/(c['family'].replace(' ','')+'.ttf'),size=r['size'],small=round(-r['scriptHeight']*.12*2)/2,sub=r['script']=='subscript',native=r['risePt']))
folder=ROOT/'tests/fixtures/script-metric-controls';ref=json.loads((folder/'reference.json').read_text())
assert hashlib.sha256((folder/'controls.docx').read_bytes()).hexdigest()==ref['sourceSha256']
assert hashlib.sha256((folder/'controls-native.pdf').read_bytes()).hexdigest()==ref['pdfSha256']
for c in ref['pages']:
 path=folder/c['font'];assert hashlib.sha256(path.read_bytes()).hexdigest()==c['fontSha256']
 for s in ['superscript','subscript']:rows.append(dict(label=c['font'],path=path,size=20,small=round(c[s]['size']*2)/2,sub=s=='subscript',native=c[s]['rise']))
folder=ROOT/'tests/fixtures/bundled-script';ref=json.loads((folder/'position-reference.json').read_text())
assert hashlib.sha256((folder/'control.docx').read_bytes()).hexdigest()==ref['sourceSha256']
assert hashlib.sha256((folder/'cases.json').read_bytes()).hexdigest()==ref['casesSha256']
for c in ref['cases']:
 path=ROOT/'public/fonts'/c['font'];assert hashlib.sha256(path.read_bytes()).hexdigest()==c['fontSha256']
 assert hashlib.sha256((folder/c['metafile']).read_bytes()).hexdigest()==c['metafileSha256']
 for r in c['rows']:rows.append(dict(label=c['family']+'/'+c['face'],path=path,size=r['size'],small=round(-r['scriptHeight']*.12*2)/2,sub=r['script']=='subscript',native=r['risePt']))
fonts={}
def font(path):
 if path not in fonts:fonts[path]=TTFont(path)
 return fonts[path]
q=lambda n:math.floor(n*.24+.5)/2
nearest=lambda n:math.floor(n+.5)
def predict(r):
 f=font(r['path']);o=f['OS/2'];h=f['hhea'];em=f['head'].unitsPerEm
 ppem=nearest(r['size']/.12);smallSize=r['small'] if r['sub'] else min(r['small'],nearest(r['size']*2*2/3)/2);small=nearest(smallSize/.12)
 leading=max(0,h.ascent-h.descent+h.lineGap-o.usWinAscent-o.usWinDescent)
 def metrics(p):
  asc=nearest(p*o.usWinAscent/em);desc=nearest(p*o.usWinDescent/em)
  if 'VDMX' in f:
   v=f['VDMX'];groups=[v.groups[a['groupIndex']] for a in v.ratRanges if a['bCharSet']==1 and (a['xRatio']==0 or a['xRatio']==1 and a['yStartRatio']<=1<=a['yEndRatio'])]
   if groups and p in groups[0]:asc,low=groups[0][p];desc=-low
  return asc,desc,nearest(p*leading/em),nearest(p*o.usWinAscent/em),nearest(p*o.usWinDescent/em)
 a=metrics(ppem);b=metrics(small)
 fallback=nearest(r['size']*2*o.ySuperscriptYOffset/em)<math.floor(r['size']/2) or nearest(r['size']*2*o.ySubscriptYOffset/em)>math.floor(r['size'])
 fixed=nearest(r['size']*2*(.2 if r['sub'] else .4))/2
 recommended=fixed if fallback else nearest(r['size']*2*(o.ySubscriptYOffset if r['sub'] else o.ySuperscriptYOffset)/em)/2
 gap=min(q(a[1]),max(q(a[4]),nearest(r['size'])/2))-min(q(b[1]),max(q(b[4]),nearest(smallSize)/2)) if r['sub'] else min(q(a[0]+a[2]),max(q(a[3]+a[2]),r['size']))-min(q(b[0]),max(q(b[3]),smallSize))
 return min(gap,recommended)*(-1 if r['sub'] else 1),[a,b,fixed,recommended]
bad=[]
for r in rows:
 actual,metrics=predict(r)
 if abs(actual-r['native'])>=.061:bad.append(dict(label=r['label'],size=r['size'],sub=r['sub'],native=r['native'],actual=actual,metrics=metrics))
out=dict(scope='Diagnostic offsets with native reduced sizes as inputs; not an end-to-end renderer rule.',cases=len(rows),matches=len(rows)-len(bad),failures=bad)
args.output.write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out,indent=2))
