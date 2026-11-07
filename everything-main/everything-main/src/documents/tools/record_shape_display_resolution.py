"""Record native interior stroke profiles at 384 dpi; retain exact provenance."""
from pathlib import Path
import hashlib,json
import pypdfium2 as pdf

folder=Path(__file__).resolve().parents[1]/'tests/fixtures/shape-display-resolution'
document=pdf.PdfDocument(folder/'native.pdf')
assert len(document)==1
image=document[0].render(scale=16/3).to_pil().convert('RGB')
assert image.size==(3264,4224)
profiles=[{'y':y,'x':379,'ink':[255-image.getpixel((x,y))[0] for x in range(379,390)]} for y in [640,700,800]]
assert all(max(p['ink'])==255 for p in profiles)
reference={'referenceVersion':'16.0.20326','dpi':384,'pageSize':list(image.size),'sourceSha256':hashlib.sha256((folder/'control.docx').read_bytes()).hexdigest(),'pdfSha256':hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(),'profiles':profiles}
(folder/'reference.json').write_text(json.dumps(reference,indent=2)+'\n')
print('Recorded three native thin-outline profiles.')
