"""Independent fractional-phase DOCX companion to the integer curve controls."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
import argparse,json
from lxml import etree as E

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'tests/fixtures/svg-cubic-step-changes'


def generate(out):
    out.mkdir(parents=True,exist_ok=True)
    with ZipFile(BASE/'control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
    cases=json.loads((BASE/'cases.json').read_bytes())
    svg=E.fromstring(parts['word/media/vector.svg'])
    paths=svg.findall('{http://www.w3.org/2000/svg}g/{http://www.w3.org/2000/svg}path')
    assert len(paths)==len(cases)==8
    for case,path in zip(cases,paths,strict=True):
        assert path.get('d')==case['path']
        points=[[x+1/16,y+1/16] for x,y in case['points']]
        d='M'+' '.join(map(str,points[0]))+'C'+' '.join(str(v) for p in points[1:] for v in p)+'Z'
        path.set('d',d)
        case.update(points=points,path=d,phase=[1/16,1/16])
    parts['word/media/vector.svg']=E.tostring(svg)
    with ZipFile(out/'control.docx','w',ZIP_DEFLATED) as z:
        for name,data in parts.items():
            info=ZipInfo(name,(2026,10,3,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
    (out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output',type=Path)
    generate(parser.parse_args().output)
