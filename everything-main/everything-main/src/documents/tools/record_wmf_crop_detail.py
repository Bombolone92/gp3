"""Native effect colors and fine-line counts, independently sampled from the native reference."""
from pathlib import Path
import hashlib
import json
import numpy as np
import pypdfium2 as pdf

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/wmf-crop-detail'
document = pdf.PdfDocument(ROOT / 'effects-native.pdf')
assert len(document) == 1
cases = []
for device_scale in [2, 4]:
    scale = device_scale * 4/3
    image = np.array(document[0].render(scale=scale).to_pil().convert('RGB'))
    profiles, samples = [], []
    for i in range(8):
        x, y = 60+260*(i % 2), 100+140*(i//2)
        low, high = [(1,43),(1,34),(1,34),(15,51)][i//2]
        px, first, last = round((x+100)*scale), round((y+low)*scale), round((y+high)*scale)
        mask = image[first:last, px].min(axis=1) < 210
        count = int(np.count_nonzero(mask & ~np.r_[False,mask[:-1]]))
        assert count == [14,9,9,14][i//2], (device_scale,i,count)
        profiles.append(dict(case=i,x=x+100,top=y+low,bottom=y+high,count=count))
        if i % 2:
            # A wide triangle's analytic interior tests the effect color without
            # claiming that the native effect-specific placeable scale bias matches.
            cx, cy = .5, 235/450
            if i in (3,5):
                cx, cy = (cx-.1)/.7, (cy-.25)/.6
                if i == 5:
                    cx = 1-cx
            if i == 7:
                cx, cy = (cx+.2)/1.1, (cy+.15)/1.1
            px, py = round((x+cx*200)*scale), round((y+cy*90)*scale)
            color = image[py,px]
            assert color.min()<210 and np.all(image[py-1:py+2,px-1:px+2] == color)
            samples.append(dict(case=i,x=px/scale,y=py/scale,color=color.tolist()))
            continue
        # Standard WMFs additionally compare stable thin ink and clear gaps.
        radius = 2
        colored, white = [], []
        for py in range(round(y*scale)+radius,round((y+90)*scale)-radius,3 if device_scale==2 else 7):
            for px in range(round(x*scale)+radius,round((x+200)*scale)-radius,3 if device_scale==2 else 7):
                color = image[py,px]
                if not np.all(image[py-radius:py+radius+1,px-radius:px+radius+1] == color):
                    continue
                item=dict(case=i,x=px/scale,y=py/scale,color=color.tolist())
                if color.min()<210:
                    colored.append(item)
                elif color.min()==255:
                    white.append(item)
        assert colored, (device_scale,i)
        # Evenly sample the complete area, retaining both ink and clear gaps.
        for values in [colored,white]:
            step=max(1,len(values)//60)
            samples.extend(values[::step][:60])
    cases.append(dict(deviceScale=device_scale,profiles=profiles,samples=samples))
reference=dict(sha256={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
    for name in ['control.docx','native.pdf','effects.docx','effects-native.pdf']},cases=cases)
(ROOT/'reference.json').write_text(json.dumps(reference,separators=(',',':'))+'\n')
print('native samples',sum(len(c['samples']) for c in cases))
