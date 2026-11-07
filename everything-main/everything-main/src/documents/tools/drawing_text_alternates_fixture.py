"""Original WPS/VML text-frame alternate control; no third-party assets."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
import re
import sys
import tempfile
import drawing_text_editing_fixture as base

def generate(destination):
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='drawing-text-alternates-') as directory:
        base.ROOT=Path(directory)
        base.generate()
        with ZipFile(base.ROOT/'control.docx') as archive:
            parts={name:archive.read(name) for name in archive.namelist()}
    document=parts['word/document.xml'].decode('utf-8')
    document=document.replace('<w:document ', '<w:document xmlns:v="urn:schemas-microsoft-com:vml" ')
    modern=re.search(r'<w:drawing>[\s\S]*?</w:drawing>',document)[0]
    text=base.paragraph('Standalone title',True)+base.paragraph('Original second paragraph')
    legacy='<w:pict><v:shape id="LegacyTextFrame" coordsize="21600,21600" style="width:120pt;height:60pt" fillcolor="#DDEEFF" stroked="f" path="m0,0l21600,0,21600,21600,0,21600xe"><v:textbox inset="6pt,3pt,6pt,3pt"><w:txbxContent>'+text+'</w:txbxContent></v:textbox></v:shape></w:pict>'
    alternate='<mc:AlternateContent><mc:Choice Requires="wps">'+modern+'</mc:Choice><mc:Fallback>'+legacy+'</mc:Fallback></mc:AlternateContent>'
    document=document.replace(modern,alternate,1)
    parts['word/document.xml']=document.encode('utf-8')
    with ZipFile(destination/'control.docx','w',ZIP_DEFLATED) as archive:
        for name,content in parts.items():archive.writestr(name,content)
    (destination/'cases.json').write_text(json.dumps({'scope':'Original single WPS frame with a VML text fallback; two plain grouped neighbors.','branches':['WPS Choice','VML Fallback'],'titleBefore':'Standalone title','titleAfter':'Updated title'},indent=2)+'\n',encoding='utf-8')
    print(destination/'control.docx')

if __name__=='__main__':generate(Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]/'tests/fixtures/drawing-text-alternates')
