"""Record native reference glyph positions and physical page sizes."""
from pathlib import Path
import json
import runpy
import sys
import pypdfium2 as pdfium
root=Path(__file__).resolve().parents[1]
sys.argv=[str(root/'tools/reviewed_font_reference.py'),'mixed-page-sizes']
runpy.run_path(sys.argv[0],run_name='__main__')
folder=root/'tests/fixtures/mixed-page-sizes'
p=folder/'reference.json'
result=json.loads(p.read_text())
result['sizes']=[list(page.get_size()) for page in pdfium.PdfDocument(folder/'native.pdf')]
p.write_text(json.dumps(result,indent=2)+'\n')
