"""Original paired cell-border owners; authored OPC/XML, no viewer exports."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import argparse
from canvas_first_section_fixture import parts as base, W, R, CT

def generate(folder):
    folder.mkdir(parents=True, exist_ok=True)
    paragraph = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>'
    for owner in ['top', 'bottom']:
        parts = dict(base)
        parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', f'<Override PartName="/word/settings.xml" ContentType="{CT}settings+xml"/></Types>')
        parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>', f'<Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>')
        parts['word/settings.xml'] = f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
        rows=[]
        for row in range(2):
            cells=[]
            for column in range(2):
                sides=[]
                for side in ['top', 'left', 'bottom', 'right']:
                    hidden = (owner == 'top' and row == 0 and side == 'bottom') or (owner == 'bottom' and row == 1 and side == 'top')
                    sides.append(f'<w:{side} w:val="nil"/>' if hidden else f'<w:{side} w:val="single" w:sz="2" w:color="000000"/>')
                cells.append(f'<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/><w:tcBorders>{"".join(sides)}</w:tcBorders></w:tcPr>{paragraph}</w:tc>')
            rows.append(f'<w:tr><w:trPr><w:trHeight w:val="600" w:hRule="exact"/></w:trPr>{"".join(cells)}</w:tr>')
        margins=''.join(f'<w:{side} w:w="0" w:type="dxa"/>' for side in ['top','left','bottom','right'])
        table=f'<w:tbl><w:tblPr><w:tblpPr w:vertAnchor="page" w:horzAnchor="page" w:tblpX="360" w:tblpY="309"/><w:tblW w:w="1200" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar>{margins}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="600"/></w:tblGrid>{"".join(rows)}</w:tbl>'
        geometry='<w:pgSz w:w="5760" w:h="4320"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/>'
        parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{table}{paragraph}<w:sectPr>{geometry}</w:sectPr></w:body></w:document>'
        with ZipFile(folder/f'{owner}.docx','w') as archive:
            for name,data in parts.items():
                info=ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=ZIP_DEFLATED
                archive.writestr(info,data)

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'tests/fixtures/border-shared-origin')
    generate(parser.parse_args().output)
