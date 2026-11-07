"""Record repeated-glyph native advances without distributing native fonts/PDF."""
from pathlib import Path
import json,hashlib,sys,re
import pypdfium2 as pdfium
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/text-advance-grid'
work=Path(sys.argv[1]);pdf=work/'text-advance-grid-native.pdf'
assert (folder/'control.docx').read_bytes()==(work/'text-advance-grid-native.docx').read_bytes()
cases=json.loads((folder/'cases.json').read_text())
doc=pdfium.PdfDocument(pdf);assert len(doc)==1
page=doc[0];text=page.get_textpage();raw=text.get_text_range()
lines=[m for m in re.finditer(r'[^\r\n]+',raw)]
assert len(lines)==len(cases),(len(lines),raw)
records=[]
for case,line in zip(cases,lines):
    assert line.group()==case['text'],(case,line.group())
    xs=[text.get_charbox(i)[0] for i in range(line.start(),line.end())]
    records.append(dict(id=case['id'],glyphLeftsPt=xs,averageAdvancePt=(xs[-1]-xs[0])/(len(xs)-1)))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
ref=dict(sourceSha256=sha(folder/'control.docx'),casesSha256=sha(folder/'cases.json'),pdfSha256=sha(pdf),pageSizePt=page.get_size(),records=records)
(folder/'reference.json').write_text(json.dumps(ref,indent=2)+'\n')
for c,r in zip(cases,records):print(c['family'],c['bold'],c['glyph'],round(r['averageAdvancePt'],6))
text.close();page.close();doc.close()
