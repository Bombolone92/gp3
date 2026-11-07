"""Original narrow cubic arches isolating native terminal-coordinate rounding."""
from pathlib import Path
import argparse,json
import canvas_svg_fixture as fixture

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/svg-cubic-terminal-rounding'

def generate(out=OUT):
    out.mkdir(parents=True,exist_ok=True)
    cases=[];groups=[]
    for width in [1,3]:
        for height in [4,12]:
            for phaseX in [0,.0625]:
                for phaseY in [0,.0625]:
                    i=len(cases);x=2+20*(i%5)+phaseX;y=10+35*(i//5)+phaseY
                    points=[[x,y],[x,y+height],[x+width,y+height],[x+width,y]]
                    path=f'M{x} {y}C{x} {y+height} {x+width} {y+height} {x+width} {y}L{x+width} {y+18}L{x} {y+18}Z'
                    cases.append(dict(name=f'width-{width}-height-{height}-phase-{phaseX}-{phaseY}',points=points,path=path,opacity='.8'))
                    groups.append(f'<g opacity=".8"><path d="{path}" fill="#2060C0"/></g>')
    fixture.SOURCE=out/'control.docx'
    fixture.SVG=('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160">'+''.join(groups)+'</svg>').encode()
    fixture.generate()
    (out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output-dir',type=Path,default=OUT)
    generate(parser.parse_args().output_dir)
