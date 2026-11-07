"""Original long SVG text reference: ordinary whitespace collapses visibly.

No corpus artwork or font binary. Reuses the original SVG-use package container.
"""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
import argparse,hashlib,json

ROOT=Path(__file__).resolve().parents[1]


def generate(out):
    out.mkdir(parents=True,exist_ok=True)
    with ZipFile(ROOT/'public/fixtures/svg-use-pictures.docx') as z:
        parts={name:z.read(name) for name in z.namelist()}
    rows=[]
    for name,spaces in [('control.docx',120000),('compact.docx',1)]:
        text='Large'+' '*spaces+'SVG'
        svg=('<svg xmlns="http://www.w3.org/2000/svg" '
             'xmlns:xlink="http://www.w3.org/1999/xlink" width="120" height="80" viewBox="0 0 120 80">'
             '<defs><text id="label" x="4" y="25" font-family="Arial" font-size="12" xml:space="default">'
             +text+'</text></defs><g opacity=".8"><use xlink:href="#label"/>'
             '<rect x="4" y="35" width="90" height="25" fill="#2060C0"/></g></svg>').encode()
        parts['word/media/vector.svg']=svg
        with ZipFile(out/name,'w',ZIP_DEFLATED) as z:
            for part,data in parts.items():
                info=ZipInfo(part,(2026,10,3,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
        rows.append(dict(file=name,sourceSha256=hashlib.sha256((out/name).read_bytes()).hexdigest(),
            textCharacters=len(text),conservativeInstanceCharacters=2*len(text),visibleText='Large SVG'))
    (out/'cases.json').write_bytes((json.dumps(rows,indent=2)+'\n').encode())


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path)
    generate(parser.parse_args().output)
