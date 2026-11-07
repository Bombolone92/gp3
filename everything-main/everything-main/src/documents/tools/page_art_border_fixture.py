"""Original small page-art controls; no corpus parts or art assets are copied."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
import argparse,json

ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'tests/fixtures/page-art-borders'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
CASES=[
    dict(name='text-21',origin='text',size=21,sides=['top','left','bottom','right']),
    dict(name='page-7',origin='page',size=7,sides=['top','left','bottom','right']),
    dict(name='page-31',origin='page',size=31,sides=['top','left','bottom','right']),
    dict(name='top-only-14',origin='text',size=14,sides=['top']),
    dict(name='mixed-21',origin='text',size=21,sides=['top','left','bottom','right'],mixed=True),
    dict(name='asymmetric',origin='page',size=21,sides=['top','left','bottom','right'],asymmetric=True),
]


def build(cases=CASES):
    # Only the repo's independently authored minimal OPC shell is reused.
    with ZipFile(ROOT/'tests/fixtures/cell-end-context/control.docx') as package:
        parts={name:package.read(name) for name in package.namelist()}
    parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>'.encode()
    body=[]
    for index,case in enumerate(cases):
        borders=[]
        for side in case['sides']:
            style='single' if case.get('mixed') and side in ('left','bottom') else 'handmade1'
            size=8 if style=='single' else ({'top':7,'left':14,'bottom':21,'right':31}[side] if case.get('asymmetric') else case['size'])
            space={'top':3,'left':7,'bottom':5,'right':9}[side]
            own=case.get('sideProperties',{}).get(side,{})
            style=own.get('style',style);size=own.get('size',size);space=own.get('space',space);color=own.get('color','223344')
            borders.append(f'<w:{side} w:val="{style}" w:sz="{size}" w:space="{space}" w:color="{color}"/>')
        section=f'<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="6000" w:h="4400"/><w:pgMar w:top="800" w:right="900" w:bottom="600" w:left="700" w:header="200" w:footer="200" w:gutter="0"/><w:pgBorders w:offsetFrom="{case["origin"]}" w:zOrder="{case.get("zOrder","front")}" w:display="{case.get("display","allPages")}">{"".join(borders)}</w:pgBorders></w:sectPr>'
        body.append(f'<w:p><w:r><w:t>Page art {index}: {case["name"]}</w:t></w:r></w:p>')
        for number in range(1,case.get('pages',1)):
            body.append(f'<w:p><w:r><w:br w:type="page"/><w:t>Page art {index}: continuation {number}</w:t></w:r></w:p>')
        if index<len(cases)-1:body.append(f'<w:p><w:pPr>{section}</w:pPr></w:p>')
        else:body.append(section)
    parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'.encode()
    return parts


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,default=FOLDER/'control.docx');args=parser.parse_args()
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with ZipFile(args.output,'w') as package:
        for name,data in build().items():
            info=ZipInfo(name,(2026,10,3,0,0,0));info.compress_type=ZIP_DEFLATED;package.writestr(info,data)
    (args.output.parent/'cases.json').write_text(json.dumps(CASES,indent=2)+'\n',encoding='utf-8')
    print(f'Authored {len(CASES)} independent page-art cases: {args.output}')
