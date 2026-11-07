"""Independent equivalent table/cell border declarations and topology controls."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import argparse, json
from canvas_first_section_fixture import parts as base, W, R, CT

def generate(folder):
    folder.mkdir(parents=True, exist_ok=True)
    p='<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>'
    cases=[]
    for line,y in enumerate([309,1748]):
        for col,(rows,columns) in enumerate([(1,1),(2,1),(1,2),(2,2)]):
            cases.append(dict(id=len(cases)+1,rows=rows,columns=columns,xTwips=360+1320*col,yTwips=y,widthTwips=960,heightTwips=1200))
    for owner in ['table','cell']:
        parts=dict(base)
        parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>',f'<Override PartName="/word/settings.xml" ContentType="{CT}settings+xml"/></Types>')
        parts['word/_rels/document.xml.rels']=parts['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>')
        parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:zoom w:percent="100"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
        body=[]
        for c in cases:
            border=lambda sides:''.join(f'<w:{side} w:val="single" w:sz="2" w:color="000000"/>' for side in sides)
            table_borders='<w:tblBorders>'+border(['top','left','bottom','right','insideH','insideV'])+'</w:tblBorders>' if owner=='table' else ''
            cell_borders='<w:tcBorders>'+border(['top','left','bottom','right'])+'</w:tcBorders>' if owner=='cell' else ''
            width=c['widthTwips']//c['columns'];height=c['heightTwips']//c['rows']
            cell=f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{cell_borders}</w:tcPr>{p}</w:tc>'
            row=f'<w:tr><w:trPr><w:trHeight w:val="{height}" w:hRule="exact"/></w:trPr>{cell*c["columns"]}</w:tr>'
            grid=''.join(f'<w:gridCol w:w="{width}"/>' for _ in range(c['columns']))
            margins=''.join(f'<w:{side} w:w="0" w:type="dxa"/>' for side in ['top','left','bottom','right'])
            body.append(f'<w:tbl><w:tblPr><w:tblpPr w:leftFromText="0" w:rightFromText="0" w:topFromText="0" w:bottomFromText="0" w:vertAnchor="page" w:horzAnchor="page" w:tblpX="{c["xTwips"]}" w:tblpY="{c["yTwips"]}"/><w:tblW w:w="{c["widthTwips"]}" w:type="dxa"/>{table_borders}<w:tblLayout w:type="fixed"/><w:tblCellMar>{margins}</w:tblCellMar></w:tblPr><w:tblGrid>{grid}</w:tblGrid>{row*c["rows"]}</w:tbl>{p}')
        geometry='<w:pgSz w:w="5760" w:h="4320"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/>'
        parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}<w:sectPr>{geometry}</w:sectPr></w:body></w:document>'
        with ZipFile(folder/f'{owner}.docx','w') as archive:
            for name,data in parts.items():
                info=ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;archive.writestr(info,data)
    (folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'tests/fixtures/border-inheritance')
    generate(parser.parse_args().output)
