"""Independent floating-table x/y phase matrix; deterministic original OPC/XML."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import argparse, json
from canvas_first_section_fixture import parts as base, W, R, CT

def generate(folder, dense=False):
    folder.mkdir(parents=True, exist_ok=True)
    parts = dict(base)
    parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', f'<Override PartName="/word/settings.xml" ContentType="{CT}settings+xml"/></Types>')
    parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>', f'<Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>')
    parts['word/settings.xml'] = f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
    paragraph = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>'
    geometry = '<w:pgSz w:w="5760" w:h="4320"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/>'
    body, cases = [], []
    page_cases=[(2,120)] if dense else [(s,h) for s in [2,18] for h in [473,479,481,487]]
    for page, (size, height) in enumerate(page_cases):
        for row, yphase in enumerate(range(15) if dense else [0,4,8,12]):
            for column, xphase in enumerate([0,4,8,12]):
                x, y = 360+1320*column+xphase, 360+(240 if dense else 960)*row+yphase
                cases.append(dict(page=page+1,id=row*4+column+1,size=size,xPhaseTwips=xphase,yPhaseTwips=yphase,xTwips=x,yTwips=y,widthTwips=960,heightTwips=height))
                borders = ''.join(f'<w:{side} w:val="single" w:sz="{size}" w:color="000000"/>' for side in ['top','left','bottom','right'])
                margins = ''.join(f'<w:{side} w:w="0" w:type="dxa"/>' for side in ['top','left','bottom','right'])
                body.append(f'<w:tbl><w:tblPr><w:tblpPr w:leftFromText="0" w:rightFromText="0" w:topFromText="0" w:bottomFromText="0" w:vertAnchor="page" w:horzAnchor="page" w:tblpX="{x}" w:tblpY="{y}"/><w:tblW w:w="960" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar>{margins}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="960"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="{height}" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="960" w:type="dxa"/></w:tcPr>{paragraph}</w:tc></w:tr></w:tbl>{paragraph}')
        if page < len(page_cases)-1:
            body.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:sectPr><w:type w:val="nextPage"/>{geometry}</w:sectPr></w:pPr></w:p>')
    body.append(f'<w:sectPr>{geometry}</w:sectPr>')
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'
    with ZipFile(folder/'control.docx','w') as archive:
        for name, data in parts.items():
            info=ZipInfo(name,date_time=(2026,1,1,0,0,0)); info.compress_type=ZIP_DEFLATED
            archive.writestr(info,data)
    (folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path)
    parser.add_argument('--dense',action='store_true',help='One thin-border page at all fifteen one-twip Y phases')
    args=parser.parse_args()
    folder=args.output or Path(__file__).resolve().parents[1]/('tests/fixtures/border-dense-phase' if args.dense else 'tests/fixtures/border-axis-phase')
    generate(folder,dense=args.dense)
