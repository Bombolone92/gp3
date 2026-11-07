"""Original single-border phase matrix, authored directly as OPC/XML."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import argparse, json
from canvas_first_section_fixture import parts as base, W, R, REL, CT

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/border-phase'
folder.mkdir(parents=True, exist_ok=True)
parser=argparse.ArgumentParser()
parser.add_argument('--name',default='control',choices=['control','holdout','reordered','filled','borderless','heights-thin','heights-wide'])
args=parser.parse_args()
phases=[2,6,10,14] if args.name=='holdout' else [0,4,8,12]
parts = dict(base)
parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', f'<Override PartName="/word/settings.xml" ContentType="{CT}settings+xml"/></Types>')
parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>', f'<Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>')
parts['word/settings.xml'] = f'<w:settings xmlns:w="{W}"><w:zoom w:percent="100"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
p = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>'
body = []
cases = []
for row, size in enumerate([2, 4, 8, 18]):
    if args.name.startswith('heights-'):
        size=2 if args.name=='heights-thin' else 18
    height=[473,479,481,487][row] if args.name.startswith('heights-') else 480
    for col, phase in enumerate(phases):
        x, y = 360+1320*col+phase, 360+960*row+phase
        cases.append(dict(id=len(cases)+1, size=0 if args.name=='borderless' else size, phaseTwips=phase, xTwips=x, yTwips=y, widthTwips=960, heightTwips=height))
        borders = ''.join(f'<w:{side} w:val="nil"/>' if args.name=='borderless' else f'<w:{side} w:val="single" w:sz="{size}" w:color="000000"/>' for side in ['top','left','bottom','right'])
        margins = ''.join(f'<w:{side} w:w="0" w:type="dxa"/>' for side in ['top','left','bottom','right'])
        body.append(f'<w:tbl><w:tblPr><w:tblpPr w:leftFromText="0" w:rightFromText="0" w:topFromText="0" w:bottomFromText="0" w:vertAnchor="page" w:horzAnchor="page" w:tblpX="{x}" w:tblpY="{y}"/><w:tblW w:w="960" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar>{margins}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="960"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="480" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="960" w:type="dxa"/></w:tcPr>{p}</w:tc></w:tr></w:tbl>{p}')
        if height!=480:body[-1]=body[-1].replace('<w:trHeight w:val="480"','<w:trHeight w:val="'+str(height)+'"')
        if args.name in ['filled','borderless']:
            body[-1]=body[-1].replace('</w:tcPr>','<w:shd w:val="clear" w:color="auto" w:fill="FF0000"/></w:tcPr>')
if args.name == 'reordered':
    body.reverse()
body.append('<w:sectPr><w:pgSz w:w="5760" w:h="4320"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'
with ZipFile(folder/f'{args.name}.docx','w') as archive:
    for name, data in parts.items():
        info=ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=ZIP_DEFLATED
        archive.writestr(info,data)
(folder/('cases.json' if args.name=='control' else f'{args.name}-cases.json')).write_text(json.dumps(cases,indent=2)+'\n')
print('Created sixteen independent phase/width controls.')
