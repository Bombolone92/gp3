"""Independent art-frame storage controls; no art tiles, native paths or fonts copied."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
import argparse,json
from page_art_border_fixture import build

SIDES=['top','left','bottom','right']
CASES=[
    dict(name='left-only-14',origin='text',size=14,sides=['left']),
    dict(name='bottom-only-21',origin='page',size=21,sides=['bottom']),
    dict(name='right-only-7',origin='text',size=7,sides=['right']),
    dict(name='missing-top-21',origin='text',size=21,sides=['left','bottom','right']),
    dict(name='ordinary-top-art-sides',origin='page',size=21,sides=SIDES,sideProperties={'top':{'style':'single','size':8}}),
    dict(name='unequal-colors',origin='page',size=21,sides=SIDES,sideProperties={s:{'color':c} for s,c in zip(SIDES,['AA2200','008844','2244AA','993399'])}),
    dict(name='first-page',origin='page',size=14,sides=SIDES,display='firstPage',pages=2),
    dict(name='not-first-page',origin='text',size=14,sides=SIDES,display='notFirstPage',pages=2),
    dict(name='back-order',origin='text',size=21,sides=SIDES,zOrder='back'),
]

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'tests/fixtures/page-art-border-holdouts/control.docx')
    args=parser.parse_args();args.output.parent.mkdir(parents=True,exist_ok=True)
    with ZipFile(args.output,'w') as package:
        for name,data in build(CASES).items():
            info=ZipInfo(name,(2026,10,5,0,0,0));info.compress_type=ZIP_DEFLATED;package.writestr(info,data)
    (args.output.parent/'cases.json').write_text(json.dumps(CASES,indent=2)+'\n',encoding='utf-8')
    print(f'Authored {len(CASES)} cases on {sum(c.get("pages",1) for c in CASES)} expected pages: {args.output}')
