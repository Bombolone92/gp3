"""Original rectangle controls for native wide-shadow sampling, independent of corpus art."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo
from copy import deepcopy
from io import BytesIO
import json, argparse
from lxml import etree as E
from PIL import Image

root = Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
mode=parser.add_mutually_exclusive_group()
mode.add_argument('--color-quantization', action='store_true')
mode.add_argument('--alpha-pipeline', action='store_true')
options=parser.parse_args()
out = root / ('tests/fixtures/shadow-alpha-pipeline' if options.alpha_pipeline else 'tests/fixtures/shadow-color-quantization' if options.color_quantization else 'tests/fixtures/shadow-raster-sampling')
out.mkdir(exist_ok=True)
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
def sub(p, ns, name, **attrs):
    return E.SubElement(p, '{'+ns+'}'+name, attrs)
with ZipFile(root/'tests/fixtures/picture-shadows/source.docx') as z:
    parts = {n:z.read(n) for n in z.namelist()}
doc = E.fromstring(parts['word/document.xml'])
body = doc.find('{'+W+'}body')
drawing = deepcopy(doc.findall('.//{'+W+'}drawing')[1])
section = deepcopy(body.find('{'+W+'}sectPr'))
section.find('{'+W+'}pgSz').attrib.update({'{'+W+'}w':'12240','{'+W+'}h':'10080'})
rid = drawing.find('.//{'+A+'}blip').get('{'+R+'}embed')
rels = E.fromstring(parts['word/_rels/document.xml.rels'])
target = next(n.get('Target') for n in rels if n.get('Id') == rid)
assert target.startswith('media/') and target.endswith('.png')
png = BytesIO(); Image.new('RGBA',(32,32),(0,0,0,255)).save(png,format='PNG')
parts['word/'+target] = png.getvalue()
for n in list(body): body.remove(n)
cases = [dict(name=f'square-{s}-blur-{b}',widthPt=s,heightPt=s,blurPt=b,offsetPt=0)
         for s in (36,72,144) for b in (18,30,42)]
cases += [dict(name=f'fractional-blur-{b}-offset-{o}',widthPt=97.5,heightPt=65.25,blurPt=b,offsetPt=o)
          for b,o in ((36,0),(48,0),(36,.3))]
cases += [dict(name=f'color-{color}-alpha-{alpha}',widthPt=72,heightPt=72,blurPt=0,offsetPt=0,color=color,alpha=alpha)
          for color in ('8040C0','FFFFFF','010203','4080C0') for alpha in (100000,60000)]
if options.color_quantization:
    cases=[dict(name=f'color-{color}-alpha-{alpha}',widthPt=72,heightPt=72,blurPt=0,offsetPt=0,color=color,alpha=alpha)
           for color in ('8040C0','FFFFFF','010203','4080C0')
           for alpha in (10000,20000,33333,40000,50000,60000,80000,90000)]
    # These separate 8-bit from 12-bit and 12-bit from 16-bit reciprocal
    # hypotheses; they were selected algebraically, before native capture.
    cases += [dict(name=f'reciprocal-{channel}-alpha-{alpha}',widthPt=72,heightPt=72,blurPt=0,offsetPt=0,
                   color=f'{channel:02X}'*3,alpha=alpha)
              for channel,alpha in ((158,14902),(180,15294),(166,17255),(247,28627),(202,40392),(187,46275))]
if options.alpha_pipeline:
    cases=[dict(name=f'source-{source_alpha}-blur-{blur}-color-{color}',widthPt=72,heightPt=72,blurPt=blur,
                offsetPt=0,color=color,alpha=60000,sourceAlpha=source_alpha)
           for source_alpha in (64,128,192) for blur in (0,3,18,48) for color in ('FFFFFF','8040C0')]
    for source_alpha in (64,128,192):
        image_rid=f'shadowSource{source_alpha}'
        assert all(n.get('Id')!=image_rid for n in rels)
        rel=deepcopy(next(n for n in rels if n.get('Id')==rid))
        rel.set('Id',image_rid);rel.set('Target',f'media/shadow-source-{source_alpha}.png');rels.append(rel)
        png=BytesIO();Image.new('RGBA',(32,32),(0,0,0,source_alpha)).save(png,format='PNG')
        parts['word/'+rel.get('Target')]=png.getvalue()
    parts['word/_rels/document.xml.rels']=E.tostring(rels)
for i,c in enumerate(cases):
    p=sub(body,W,'p')
    if i: sub(sub(p,W,'pPr'),W,'pageBreakBefore')
    sub(sub(p,W,'r'),W,'t').text=c['name']
    d=deepcopy(drawing); sub(sub(body,W,'p'),W,'r').append(d)
    if 'sourceAlpha' in c:d.find('.//{'+A+'}blip').set('{'+R+'}embed',f"shadowSource{c['sourceAlpha']}")
    d.find('.//{'+WP+'}docPr').attrib.update(dict(id=str(i+1),name=c['name']))
    ext=dict(cx=str(round(c['widthPt']*12700)),cy=str(round(c['heightPt']*12700)))
    d.find('.//{'+WP+'}extent').attrib.update(ext)
    d.find('.//{'+A+'}xfrm/{'+A+'}ext').attrib.update(ext)
    for n in d.findall('.//{'+WP+'}posOffset'):
        n.text=str(int(n.text)+round(c['offsetPt']*12700))
    effects=d.find('.//{'+PIC+'}spPr/{'+A+'}effectLst')
    for n in list(effects): effects.remove(n)
    sh=sub(effects,A,'outerShdw',blurRad=str(c['blurPt']*12700),dist=str(216*12700),dir='0',algn='tl',rotWithShape='0')
    sub(sub(sh,A,'srgbClr',val=c.get('color','000000')),A,'alpha',val=str(c.get('alpha',100000)))
body.append(section); parts['word/document.xml']=E.tostring(doc)
with ZipFile(out/'source.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items():
        info=ZipInfo(name,(2026,9,28,0,0,0)); info.compress_type=ZIP_DEFLATED; z.writestr(info,data)
(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
print(f'Generated {len(cases)} independent controls')
