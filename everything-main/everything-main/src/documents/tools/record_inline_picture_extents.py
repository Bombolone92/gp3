"""Record reference PDF text origins and image transforms without layout assumptions."""
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile
from PIL import Image
from pypdf import PdfReader

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/inline-picture-extents'
cases = json.loads((folder / 'cases.json').read_text())
observations = []
for page_index, page in enumerate(PdfReader(folder / 'native.pdf').pages):
    texts, pictures = [], []
    def text(value, cm, tm, font, size):
        if value.strip():
            texts.append(dict(text=value.strip(), x=tm[4], y=float(page.mediabox.height)-tm[5]))
    def operand(op, args, cm, tm):
        if op == b'Do':
            pictures.append(list(cm))
    page.extract_text(visitor_text=text, visitor_operand_before=operand)
    for index, item in enumerate(texts):
        if not item['text'].startswith('Case '):
            continue
        number = int(item['text'].split()[1])
        following = texts[index+1:index+4]
        assert [x['text'] for x in following] == ['Left', 'Right', 'After '+str(number)], following
        observations.append(dict(case=number, page=page_index, label=item,
                                 left=following[0], right=following[1], after=following[2],
                                 imageMatrix=pictures.pop(0)))
    assert not pictures
assert len(observations) == len(cases)
with tempfile.TemporaryDirectory(prefix='inline-picture-native-') as temp:
    prefix = Path(temp) / 'page'
    subprocess.run(['pdftoppm', '-r', '144', '-png', str(folder / 'native.pdf'), str(prefix)], check=True)
    for o in observations:
        im = Image.open(prefix.with_name('page-'+str(o['page']+1)+'.png')).convert('RGB')
        a,b,c,d,e,f = o['imageMatrix']
        o['samples'] = []
        for u,v in [(u,v) for u in [.2,.3,.7,.8] for v in [.2,.3,.7,.8]]:
            x,y = round(a*u+c*v+e),round(792-b*u-d*v-f)
            color=im.getpixel((x*2,y*2))
            if not all(im.getpixel((x*2+dx,y*2+dy))==color for dx in range(-4,5) for dy in range(-4,5)):continue
            o['samples'].append([x,y,*color])
        assert len(o['samples'])>=4,(o['case'],len(o['samples']))
digest = lambda name: hashlib.sha256((folder / name).read_bytes()).hexdigest()
reference = dict(sourceSha256=digest('control.docx'), pdfSha256=digest('native.pdf'),
                 casesSha256=digest('cases.json'), observations=observations)
(folder / 'reference.json').write_text(json.dumps(reference, indent=2)+'\n')
for c, o in zip(cases, observations):
    print(o['case'], c['angle'], 'right', o['right']['x'],
          'baseline after label', round(o['left']['y']-o['label']['y'], 3))
