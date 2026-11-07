"""Record reference text origins and border-ink bounds for original none controls."""
from pathlib import Path
from zipfile import ZipFile
import ctypes
import hashlib
import json
import sys
import pypdfium2 as pdfium

ROOT=Path(__file__).resolve().parents[1]/'tests/fixtures/cell-border-none'
COLORS={'red':(224,32,48),'blue':(32,80,208),'purple':(160,48,160),'blueFill':(208,224,240),'pinkFill':(240,208,224)}

def record(kind,native_source,pdf_path):
    with ZipFile(ROOT/(kind+'.docx')) as current, ZipFile(native_source) as native:
        for name in current.namelist():
            if name.startswith('word/'):
                assert current.read(name)==native.read(name),name
        hashes={name:hashlib.sha256(current.read(name)).hexdigest()
                for name in ['word/document.xml','word/styles.xml']}
    document=pdfium.PdfDocument(pdf_path)
    assert len(document)==6
    pages=[]
    for page in document:
        text=page.get_textpage();chars=[]
        for i in range(text.count_chars()):
            value=text.get_text_range(i,1)
            if not value.strip():continue
            x,y=ctypes.c_double(),ctypes.c_double()
            if pdfium.raw.FPDFText_GetCharOrigin(text,i,ctypes.byref(x),ctypes.byref(y)):
                font=ctypes.create_string_buffer(256);flags=ctypes.c_int()
                pdfium.raw.FPDFText_GetFontInfo(text,i,font,256,ctypes.byref(flags))
                chars.append((value,x.value,page.get_height()-y.value,font.value.decode('utf-8')))
        joined=''.join(c[0] for c in chars);origins=[]
        for label in ['Cell1','Cell2','Next1','Next2','Followingparagraph']:
            at=joined.find(label)
            if at>=0:origins.append({'text':label,'x':chars[at][1],'y':chars[at][2],'font':chars[at][3]})
        image=page.render(scale=4/3).to_pil().convert('RGB');pixels=image.load()
        bounds={}
        for name,color in COLORS.items():
            points=[(x,y) for y in range(image.height) for x in range(image.width) if pixels[x,y]==color]
            bounds[name]=[min(x for x,y in points),min(y for x,y in points),max(x for x,y in points)+1,max(y for x,y in points)+1] if points else None
        pages.append({'origins':origins,'bounds':bounds})
        text.close();page.close()
    result={'referenceBuild':'16.0.20326','partSha256':hashes,'pdfSha256':hashlib.sha256(Path(pdf_path).read_bytes()).hexdigest(),
            'pagePixels':[576,576],'colors':COLORS,'pages':pages}
    (ROOT/(kind+'-native.json')).write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(kind,len(pages),'native pages recorded')

if __name__=='__main__':record(*sys.argv[1:])
