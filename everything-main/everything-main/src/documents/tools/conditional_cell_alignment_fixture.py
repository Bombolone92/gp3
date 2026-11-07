"""Original OPC/XML controls for conditional cell vertical alignment."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from canvas_first_section_fixture import parts as base, W, R, CT
import json

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/conditional-cell-alignment'
folder.mkdir(exist_ok=True)
cases = []
variants = [('top','firstRow','bottom',None), ('center','firstRow','bottom',None),
            ('bottom','firstRow','top',None), (None,'firstRow','bottom',None),
            ('center','firstCol','bottom',None), ('center','band1Horz','bottom',None),
            ('center','nwCell','bottom',None), ('center','firstRow','bottom','top'),
            ('center','firstRow','bottom','bottom')]
for mode in [12,14,15]:
    parts = dict(base); styles = []; body = []
    for i,(unconditional,region,conditional,direct) in enumerate(variants):
        ident = f'C{i:02d}'
        styles.append(f'<w:style w:type="table" w:styleId="{ident}"><w:name w:val="{ident}"/><w:tblPr><w:tblStyleRowBandSize w:val="1"/></w:tblPr>'
                      f'<w:tcPr>{f"<w:vAlign w:val=\"{unconditional}\"/>" if unconditional else ""}</w:tcPr>'
                      f'<w:tblStylePr w:type="{region}"><w:tcPr><w:shd w:val="clear" w:fill="FFFF00"/><w:vAlign w:val="{conditional}"/></w:tcPr></w:tblStylePr></w:style>')
        rows = []
        for r in range(2):
            cells = []
            for c in range(2):
                override = f'<w:vAlign w:val="{direct}"/>' if direct and r==c==0 else ''
                cells.append(f'<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/>{override}</w:tcPr><w:p><w:r><w:t>{ident}R{r}C{c}</w:t></w:r></w:p></w:tc>')
            rows.append('<w:tr><w:trPr><w:trHeight w:val="800" w:hRule="exact"/></w:trPr>'+''.join(cells)+'</w:tr>')
        borders=''.join(f'<w:{s} w:val="single" w:sz="4" w:color="000000"/>' for s in ['top','left','bottom','right','insideH','insideV'])
        body.append(f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if i else ""}</w:pPr><w:r><w:t>{ident}</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblStyle w:val="{ident}"/><w:tblW w:w="4800" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0" w:firstRow="1" w:firstColumn="1" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>{"".join(rows)}</w:tbl>')
        cases.append(dict(mode=mode,page=i,id=ident,base=unconditional,region=region,conditional=conditional,direct=direct))
    parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults>{"".join(styles)}</w:styles>'
    parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="{mode}"/></w:compat></w:settings>'
    parts['word/_rels/document.xml.rels']=parts['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>')
    parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>',f'<Override PartName="/word/settings.xml" ContentType="{CT}settings+xml"/></Types>')
    parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}<w:p/><w:sectPr><w:pgSz w:w="7200" w:h="8000"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>'
    with ZipFile(folder/f'mode{mode}.docx','w',ZIP_DEFLATED) as z:
        for path,data in parts.items():z.writestr(path,data)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
