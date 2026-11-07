"""Independently authored rectangle controls for SVG paint-opacity precision."""
from pathlib import Path
import argparse,json
import canvas_svg_fixture as fixture

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/svg-paint-opacity-precision'

def generate(out=OUT):
    out.mkdir(parents=True,exist_ok=True)
    cases=[dict(value=v,property=p) for p in ['opacity','fill-opacity','inline-opacity'] for v in ['.2','.4','.6','.8']]
    cases += [dict(value=v,property='opacity') for v in ['.199999999','.200000001','.200000003','.399999999','.400000006','.599999999','.600000024','.799999999','.8000000121']]
    cases += [dict(value='.4',property='opacity',fillOpacity='.5'),dict(value='.8',property='opacity',fillOpacity='.5'),dict(value='.6',property='opacity',fillOpacity='.5')]
    cases += [dict(value='.8',property='opacity',style='opacity:.200000003'),
              dict(value='.8',property='opacity',cssClass='precise'),
              dict(value='.8',property='fill-opacity',cssClass='precise-fill'),
              dict(value='.8',property='opacity',cssClass='precise',id='specific'),
              dict(value='.8',property='opacity',parentFill='.4'),
              dict(value='inherit',property='fill-opacity',parentFill='.6'),
              dict(value='.8',property='fill-opacity',style='fill-opacity:.400000006'),
              dict(value='.8',property='opacity',style='opacity:.6;opacity:.200000003')]
    groups=[]
    for i,c in enumerate(cases):
        x=2+16*(i%7);y=10+38*(i//7);c.update(x=x,y=y,groupOpacity='.7')
        attr=f'style="opacity:{c["value"]}"' if c['property']=='inline-opacity' else f'{c["property"]}="{c["value"]}"'
        if 'fillOpacity' in c:attr+=f' fill-opacity="{c["fillOpacity"]}"'
        for key in ['style','id']:
            if key in c:attr+=f' {key}="{c[key]}"'
        if 'cssClass' in c:attr+=f' class="{c["cssClass"]}"'
        # Opaque interior proves brush alpha; fractional edges distinguish paint
        # quantization from coverage and group conversion. No cubic is involved.
        parent=f' fill-opacity="{c["parentFill"]}"' if 'parentFill' in c else ''
        second=attr.replace('id="specific"','id="specific-white"')
        groups.append(f'<g opacity=".7"{parent}><rect x="{x}" y="{y}" width="12" height="12" fill="#2060C0" {attr}/><rect x="{x+.125}" y="{y+15.25}" width="11.5" height="2.5" fill="#FFFFFF" {second}/></g>')
    styles='<style>.precise{opacity:.200000003}.precise-fill{fill-opacity:.400000006}#specific{opacity:.600000024}#specific-white{opacity:.600000024}</style>'
    fixture.SVG=('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="200" viewBox="0 0 120 200">'+styles+''.join(groups)+'</svg>').encode()
    fixture.SOURCE=out/'control.docx';fixture.generate()
    (out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output-dir',type=Path,default=OUT)
    generate(parser.parse_args().output_dir)
