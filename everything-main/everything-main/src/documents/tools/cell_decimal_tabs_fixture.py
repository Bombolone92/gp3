"""Original OOXML isolating decimal-tab placement inside fixed-width cells."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from xml.sax.saxutils import escape
import json
from canvas_first_section_fixture import parts as base, W, R, CT

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/cell-decimal-tabs'
CASES = [dict(text=t) for t in ['12.3','1.23','$12.30','X','Text 12.3 kg','123','12,345.6','', '\t12.3','\tX','12.3\tX','\t\t12.3','A\t12.3','12.3\v4.56']]
CASES += [dict(text=t, stops=stops) for stops in [
    [('left',720),('decimal',1440)], [('decimal',720),('decimal',1440)],
    [('decimal',720),('left',1440)], [('right',1440)]] for t in ['12.3','\t12.3']]
CASES += [dict(text='12.3',alignment=a) for a in ['center','right']]
CASES += [dict(text=t,left=540,first=f) for t,f in [('12.3',0),('\t12.3',0),('12.3',-540),('\t12.3',-540)]]
CASES += [dict(text=t,leader='dot') for t in ['12.3','\t12.3']]


def build(mode, auto=False):
    parts = dict(base)
    parts['word/settings.xml'] = f'<w:settings xmlns:w="{W}"><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="{mode}"/></w:compat></w:settings>'
    parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>', f'<Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>')
    parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', f'<Override PartName="/word/settings.xml" ContentType="{CT}settings+xml"/></Types>')
    parts['word/styles.xml'] = f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'
    body = []
    for i,c in enumerate(CASES):
        page_break = '<w:pageBreakBefore/>' if i and i % 6 == 0 else ''
        body.append(f'<w:p><w:pPr>{page_break}</w:pPr><w:r><w:t>Case {i+1}</w:t></w:r></w:p>')
        stops = ''.join(f'<w:tab w:val="{kind}" w:pos="{pos}" w:leader="{c.get("leader","none")}"/>' for kind,pos in c.get('stops',[('decimal',1440)]))
        first = c.get('first',0)
        indent = f'<w:ind w:left="{c.get("left",0)}" ' + (f'w:hanging="{-first}"' if first<0 else f'w:firstLine="{first}"') + '/>'
        content = '<w:r><w:t xml:space="preserve">'+escape(c['text']).replace('\t','</w:t><w:tab/><w:t xml:space="preserve">').replace('\v','</w:t><w:br/><w:t xml:space="preserve">')+'</w:t></w:r>'
        paragraph = f'<w:p><w:pPr><w:tabs>{stops}</w:tabs>{indent}<w:jc w:val="{c.get("alignment","left")}"/></w:pPr>{content}</w:p>'
        body.append('<w:tbl><w:tblPr><w:tblW w:w="4800" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4800"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="4800" w:type="dxa"/></w:tcPr>'+paragraph+'</w:tc></w:tr></w:tbl>')
    body.append('<w:p/><w:sectPr><w:pgSz w:w="7200" w:h="9000"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>')
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'
    if auto:
        parts['word/document.xml'] = parts['word/document.xml'].replace('<w:tblW w:w="4800" w:type="dxa"/><w:tblLayout w:type="fixed"/>','<w:tblW w:w="0" w:type="auto"/>').replace('w:w="4800"','w:w="200"')
    with ZipFile(OUT/f'mode{mode}{"-auto" if auto else ""}.docx','w') as z:
        for name,content in parts.items():
            info=ZipInfo(name,(2026,9,27,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,content)


if __name__ == '__main__':
    OUT.mkdir(exist_ok=True)
    for mode in [12,15]:
        build(mode)
        build(mode,True)
    (OUT/'cases.json').write_text(json.dumps(CASES,indent=2)+'\n',encoding='utf8')
