"""Record native PDF image centers for the independently authored color grid."""
from pathlib import Path
from pypdf import PdfReader
from PIL import Image
from io import BytesIO
import json,hashlib
root=Path(__file__).resolve().parents[1]/'tests/fixtures/jpeg-color-change'
cases=json.loads((root/'thresholds.json').read_text())
reader=PdfReader(root/'thresholds-native.pdf');records=[];filters=[]
assert len(reader.pages)==len(cases['cases'])
for i,page in enumerate(reader.pages):
 images=[ref.get_object() for ref in page['/Resources']['/XObject'].values() if ref.get_object().get('/Subtype')=='/Image']
 assert len(images)==1
 x=images[0];assert x['/Width']==512 and x['/BitsPerComponent']==8 and x['/ColorSpace']=='/DeviceRGB'
 filters.append(str(x.get('/Filter')))
 rgb=x.get_data()
 if x.get('/Filter')=='/DCTDecode':rgb=Image.open(BytesIO(rgb)).convert('RGB').tobytes()
 assert len(rgb)==x['/Width']*x['/Height']*3
 mask=x.get('/SMask');alpha=mask.get_object().get_data() if mask else bytes([255])*(x['/Width']*x['/Height'])
 samples=[]
 for j in range(len(cases['colors'])):
  at=(j//cases['columns']*cases['size']+cases['size']//2)*x['/Width']+j%cases['columns']*cases['size']+cases['size']//2
  samples.append([*rgb[at*3:at*3+3],alpha[at]])
 records.append(samples)
result={'referenceBuild':'16.0.20326','sourceSha256':hashlib.sha256((root/'thresholds.docx').read_bytes()).hexdigest(),'pdfSha256':hashlib.sha256((root/'thresholds-native.pdf').read_bytes()).hexdigest(),'pdfFilters':filters,'samples':records}
(root/'reference.json').write_text(json.dumps(result,separators=(',',':'))+'\n')
