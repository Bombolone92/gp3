"""Original SVG translucent cubic groups, independent of corpus artwork."""
import json
import argparse
from pathlib import Path
import canvas_svg_fixture as fixture

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/svg-group-cubic'


def generate(out=OUT,holdouts=False):
    out.mkdir(parents=True,exist_ok=True)
    controls=[(0,24,16,24),(1,31,13,7),(.2,23.7,15.8,11.3),(4,.2,12,.7),(15,30,1,30),(0,0,16,0)]
    cases=[]
    for i,(a,b,c,d) in enumerate(controls):
        x=2+20*i;y=10
        # Each control isolates one cubic and its straight closing edges.
        path=f'M{x} {y}C{x+a} {y+b} {x+c} {y+d} {x+16} {y}L{x+16} 70L{x} 70Z'
        cases.append(dict(index=i,path=path,opacity=.8))
    width,height=120,80
    if holdouts:
        width,height=600,200
        cases=[
            dict(index=0,path='M2 10C2 42 32 42 32 10C32 60 60 60 60 10L60 90L2 90Z',opacity=.5),
            dict(index=1,path='M102 10C102 42 132 42 132 10 132 60 160 60 160 10L160 90L102 90Z',opacity=.5),
            dict(index=2,path='M-10 -12C-10 36 32 36 32 -12L32 70L-10 70Z',opacity=.8,transform='translate(220 20)',nested=.8,fillOpacity=.6),
            dict(index=3,path='M302 10C302 80 370 80 370 10L370 100L302 100Z M320 80C320 100 350 100 350 80L350 95L320 95Z',opacity=.999,rule='evenodd'),
            dict(index=4,path='M402 10C475 160 402 -30 475 100L402 100Z M430 110C440 150 450 150 460 110L430 110Z',opacity=.8,rule='nonzero'),
            dict(index=5,path='M502.062499 10.062501C510.062501 38.062499 540.062499 65.062501 570.062501 10.062499L570.062501 100.062499L502.062499 100.062499Z',opacity=.75),
        ]
    groups=[]
    for case in cases:
        if not holdouts:
            groups.append(f'<g opacity=".8"><path d="{case["path"]}" fill="#2060C0"/></g>')
            continue
        attrs=' '.join(f'{key}="{value}"' for key,value in [('fill-rule',case.get('rule','nonzero')),('fill-opacity',case.get('fillOpacity',1))])
        path=f'<path d="{case["path"]}" fill="#2060C0" {attrs}/>'
        if 'nested' in case:path=f'<g opacity="{case["nested"]}">{path}</g>'
        groups.append(f'<g opacity="{case["opacity"]}" transform="{case.get("transform","")}">{path}</g>')
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">'+''.join(groups)+'</svg>'
    fixture.SOURCE=out/'control.docx';fixture.SVG=svg.encode();fixture.generate()
    (out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--holdouts',action='store_true');parser.add_argument('--output-dir',type=Path)
    args=parser.parse_args()
    generate(args.output_dir or (OUT.with_name('svg-group-cubic-holdouts') if args.holdouts else OUT),args.holdouts)
