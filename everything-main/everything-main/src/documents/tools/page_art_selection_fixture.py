"""Independent page-art selection/partial-side controls; no border tiles copied."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from itertools import combinations
import argparse,json
import page_art_border_fixture as shell

SIDES=['top','left','bottom','right']
CASES=[{'name':'uniform-7','sides':SIDES,'sizes':{s:7 for s in SIDES}}]
CASES += [{'name':'only-'+s,'sides':[s],'sizes':{s:7}} for s in SIDES]
CASES += [{'name':'pair-'+'-'.join(pair),'sides':list(pair),'sizes':{s:7 for s in pair}} for pair in combinations(SIDES,2)]
for index,side in enumerate(SIDES):
    sizes={s:[7,14,21,31][(i-index)%4] for i,s in enumerate(SIDES)}
    CASES.append({'name':'unequal-'+side+'-7','sides':SIDES,'sizes':sizes})
CASES += [{'name':'art-'+side+'-ordinary-others','sides':SIDES,'sizes':{s:7 if s==side else 8 for s in SIDES},'ordinary':[s for s in SIDES if s!=side]} for side in SIDES]
CASES += [{'name':'no-top-21','sides':SIDES[1:],'sizes':{s:21 for s in SIDES[1:]}},
          {'name':'ordinary-top-art-21','sides':SIDES,'sizes':{s:8 if s=='top' else 21 for s in SIDES},'ordinary':['top']}]

def build():
    parts=shell.build();body=[]
    for i,case in enumerate(CASES):
        borders=''.join(f'<w:{side} w:val="{"single" if side in case.get("ordinary",[]) else "handmade1"}" w:sz="{case["sizes"][side]}" w:space="{dict(top=3,left=7,bottom=5,right=9)[side]}" w:color="223344"/>' for side in case['sides'])
        section=f'<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="6000" w:h="4400"/><w:pgMar w:top="800" w:right="900" w:bottom="600" w:left="700" w:header="200" w:footer="200" w:gutter="0"/><w:pgBorders w:offsetFrom="page" w:zOrder="front" w:display="allPages">{borders}</w:pgBorders></w:sectPr>'
        body.append('<w:p/>')
        body.append(f'<w:p><w:pPr>{section}</w:pPr></w:p>' if i<len(CASES)-1 else section)
    parts['word/document.xml']=f'<w:document xmlns:w="{shell.W}"><w:body>{"".join(body)}</w:body></w:document>'.encode()
    return parts

def generate(folder):
    if folder.exists() and (not folder.is_dir() or any(folder.iterdir())):
        raise ValueError('Use a fresh or empty directory; captured evidence is never replaced')
    folder.mkdir(parents=True,exist_ok=True)
    with ZipFile(folder/'control.docx','x') as package:
        for name,data in build().items():
            info=ZipInfo(name,(2026,10,4,0,0,0));info.compress_type=ZIP_DEFLATED;package.writestr(info,data)
    rows=[dict(case,pageWidthPt=300,pageHeightPt=220) for case in CASES]
    with (folder/'cases.json').open('x',encoding='utf8') as out:out.write(json.dumps(rows,indent=2)+'\n')
    print(f'Authored {len(rows)} textless page-art controls')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output-folder',type=Path,required=True)
    generate(parser.parse_args().output_folder)
