"""Independently authored OPC/XML for a related Settings part outside word/."""
from canvas_first_section_fixture import parts as shell, W, R, CT
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

parts = dict(shell)
parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', f'<Override PartName="/config/settings2.xml" ContentType="{CT}settings+xml"/></Types>')
parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>', f'<Relationship Id="settings" Type="{R}/settings" Target="../config/settings2.xml"/></Relationships>')
parts['config/settings2.xml'] = f'<w:settings xmlns:w="{W}"><w:defaultTabStop w:val="1440"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
parts['word/styles.xml'] = f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'
p = lambda text: f'<w:p><w:r><w:t>{text}</w:t></w:r></w:p>'
table = '<w:tbl><w:tblPr><w:tblW w:type="pct" w:w="5000"/><w:tblLayout w:type="autofit"/><w:tblCellMar><w:top w:type="dxa" w:w="0"/><w:left w:type="dxa" w:w="120"/><w:bottom w:type="dxa" w:w="0"/><w:right w:type="dxa" w:w="120"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="1440"/><w:gridCol w:w="7920"/></w:tblGrid><w:tr>'
for width,text in [(1440,'Label'),(7920,'Value')]:
    table += f'<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="{width}"/></w:tcPr>{p(text)}</w:tc>'
table += '</w:tr></w:tbl>'
parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body><w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t></w:r></w:p>{table}{p("After table")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
if __name__ == '__main__':
    path=Path(__file__).resolve().parents[1]/'public/fixtures/settings-location.docx'
    with ZipFile(path,'w',ZIP_DEFLATED) as z:
        for name,text in parts.items(): z.writestr(name,text)
    print(path)
