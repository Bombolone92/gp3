"""Extract native shadow samples and independent flag comparisons from reference PDF."""
from pathlib import Path
import hashlib,json
import pypdfium2 as pdf
from pypdf import PdfReader
from PIL import ImageChops

folder=Path(__file__).resolve().parents[1]/'tests/fixtures/picture-shadows'
cases=json.loads((folder/'cases.json').read_text(encoding='utf-8'))
document=pdf.PdfDocument(folder/'native.pdf');reader=PdfReader(folder/'native.pdf')
assert len(document)==len(cases)==len(reader.pages)
images=[page.render(scale=4).to_pil().convert('RGB') for page in document]
box=(288,400,1000,1040)  # picture and shadow, excluding heading
regions={name:images[i].crop(box) for i,(name,_) in enumerate(cases)}
for a,b in [('blur4','obscured-false'),('obscured-true','no-fill-true'),
            ('blur4','no-fill-false'),('obscured-false','obscured-default')]:
    assert ImageChops.difference(regions[a],regions[b]).getbbox() is None,(a,b)
assert ImageChops.difference(regions['obscured-true'],regions['obscured-false']).getbbox()
points={'transparent':[90,120],'halfAlpha':[140,120],'opaqueBlue':[190,120],
        'opaqueYellow':[190,210],'shadowRight':[222,180],'shadowBelow':[170,250]}
profiles={'right':[(212+x/2,180) for x in range(65)],
          'bottom':[(170,240+x/2) for x in range(57)],
          'left':[(50+x/2,180) for x in range(53)],
          'top':[(170,78+x/2) for x in range(53)]}
result={'referenceVersion':'16.0.20326','dpi':288,
        'sourceSha256':hashlib.sha256((folder/'source.docx').read_bytes()).hexdigest(),
        'pdfSha256':hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(),
        'framePt':{'x':72,'y':100,'width':144,'height':144},
        'samplePointsPt':points,'profilePointsPt':profiles,'pages':[]}
for i,(name,_) in enumerate(cases):
    assert reader.pages[i].extract_text().strip()==name
    def sample(p):return images[i].getpixel((round(p[0]*4),round(p[1]*4)))
    result['pages'].append({'name':name,'samples':{key:sample(p) for key,p in points.items()},
        'profiles':{key:[sample(p) for p in values] for key,values in profiles.items()},
        'pdfImages':[{'name':im.name,'size':im.image.size} for im in reader.pages[i].images]})
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(f'PASS {len(cases)} page labels; four pixel-identical flag pairs; obscuration changes visible pixels')
print('Native PDF bitmap sizes:',[(result['pages'][i]['name'],result['pages'][i]['pdfImages'][0]['size']) for i in [1,2,3]])
