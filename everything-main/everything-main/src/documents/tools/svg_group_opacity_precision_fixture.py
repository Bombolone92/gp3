"""Original controls for native SVG group-opacity precision at byte half ties."""
from pathlib import Path
import json,argparse
import canvas_svg_fixture as fixture

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/svg-group-opacity-precision'

def generate(out=OUT,holdouts=False,cascade=False):
    out.mkdir(parents=True,exist_ok=True)
    values=['0.1','0.3','0.5','0.7','0.9','0.69999999','0.70000001',
            '0.89999999','0.90000001','0.29999999','0.30000001','0.49999999','0.50000001',
            '0.700001','0.70001','0.7000122','0.7000123','0.100001','0.1000061','0.1000062',
            '0.300003','0.3000031','0.3000032']
    if holdouts:
        values=['0.100000000','0.100000001','0.100000002','0.10000000149','0.1000000015',
                '0.300000005','0.300000011','0.300000012','0.70000004','0.700000047',
                '0.700000048','0.700000047683715','0.700000047683716','0.90000003',
                '0.900000035','0.900000036','0.499999999','0.500000001',
                '0.199999999','0.200000001','0.800000001','0.799999999']
    cases=[dict(opacity=v,x=2+16*(i%7),y=10+38*(i//7)) for i,v in enumerate(values)]
    styles=''
    if cascade:
        cases=[dict(opacity='.49999999'),dict(opacity='.7',style='opacity:.1'),
               dict(opacity='.9',cssClass='low'),dict(opacity='.1',cssClass='low',id='specific'),
               dict(opacity='.1',id='inline',style='opacity:.9'),dict(opacity='.9',cssClass='ordered'),
               dict(opacity='.9',style='opacity:.3;fill:black;opacity:.49999999'),
               dict(opacity='inherit',parent='.7'),dict(opacity='initial',parent='.7'),
               dict(opacity='unset',parent='.7'),dict(opacity='70%',parent='.8'),
               dict(opacity='.9',cssClass='inherited',parent='.3'),
               dict(opacity='.9',cssClass='descendant',parent='1'),
               dict(opacity='.9',style='opacity:calc(.2 + .3)'),
               dict(opacity='.7%',parent='.8'),dict(opacity='50%',parent='.8'),
               dict(opacity='.5%',parent='.8'),dict(opacity='.9',style='opacity:70%',parent='.8'),
               dict(opacity='.9',style='opacity:.7%',parent='.8'),
               dict(opacity='.9',style='opacity:inherit',parent='.3'),
               dict(opacity='.9',style='opacity:initial',parent='.7'),
               dict(opacity='.9',style='opacity:unset',parent='.7'),
               dict(opacity='.9',style='opacity:.3;opacity:calc(.2 + .3)'),
               dict(opacity='.9',style='opacity:1e-1'),dict(opacity='1e-1'),
               dict(opacity='.9',cssClass='inherited',reuse=True,useOpacity='.3'),
               dict(opacity='1',reuse=True,useClass='ordered',useOpacity='1'),
               dict(opacity='.9',style='opacity:inherit',reuse=True,useOpacity='.3')]
        for i,c in enumerate(cases):c.update(x=2+16*(i%7),y=10+38*(i//7))
        styles='<style>.low{opacity:.3}#specific{opacity:.7}#inline{opacity:.7}.ordered{opacity:.3}.ordered{opacity:.49999999}.inherited{opacity:inherit}.wrap .descendant{opacity:.49999999}</style>'
    groups=[]
    for i,c in enumerate(cases):
        attrs=f'opacity="{c["opacity"]}"'+''.join(f' {key}="{c[name]}"' for key,name in [('style','style'),('class','cssClass'),('id','id')] if name in c)
        group=f'<g {attrs}><rect x="{c["x"]}" y="{c["y"]}" width="12" height="12" fill="#2060C0"/><rect x="{c["x"]}" y="{c["y"]+15}" width="12" height="1" fill="#2060C0" fill-opacity=".503"/></g>'
        if c.get('reuse'):
            group=group.replace('<g ',f'<g id="reuse{i}" ',1)
            group=f'<defs>{group}</defs><use href="#reuse{i}" opacity="{c["useOpacity"]}" class="{c.get("useClass","")}"/>'
        if 'parent' in c:group=f'<g opacity="{c["parent"]}" class="wrap">{group}</g>'
        groups.append(group)
    fixture.SVG=f'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160">{styles}{"".join(groups)}</svg>'.encode()
    fixture.SOURCE=out/'control.docx';fixture.generate()
    (out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);group=parser.add_mutually_exclusive_group();group.add_argument('--holdouts',action='store_true');group.add_argument('--cascade',action='store_true');args=parser.parse_args()
    generate(OUT.with_name('svg-group-opacity-precision-cascade' if args.cascade else 'svg-group-opacity-precision-holdouts') if args.holdouts or args.cascade else OUT,args.holdouts,args.cascade)
