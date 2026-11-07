"""Independent font-table alternative probes; no proprietary fonts are bundled."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from canvas_first_section_fixture import parts as shell, W, R, CT

MISSING = 'AltProbeMissing73'
def build(alternate, path):
    missing = MISSING if alternate == 'Arial' else 'AltProbeMissing74'
    parts = dict(shell)
    parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', f'<Override PartName="/config/fonts2.xml" ContentType="{CT}fontTable+xml"/></Types>')
    parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>', f'<Relationship Id="fonts" Type="{R}/fontTable" Target="../config/fonts2.xml"/></Relationships>')
    parts['config/fonts2.xml'] = f'<w:fonts xmlns:w="{W}"><w:font w:name="{missing}"><w:altName w:val="{alternate}"/></w:font><w:font w:name="Arial"><w:altName w:val="Times New Roman"/></w:font></w:fonts>'
    parts['word/styles.xml'] = f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="{missing}" w:hAnsi="{missing}"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'
    body = '<w:p><w:r><w:t>Alternate font MWiiii</w:t></w:r></w:p>'
    body += '<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr><w:t>Available font MWiiii</w:t></w:r></w:p>'
    body += '<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="9360" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Table alternate MWiiii</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    body += '<w:p><w:r><w:t>After table</w:t></w:r></w:p>'
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
    with ZipFile(path,'w',ZIP_DEFLATED) as z:
        for name,text in parts.items(): z.writestr(name,text)
if __name__ == '__main__':
    root=Path(__file__).resolve().parents[1]/'public/fixtures'
    build('Arial',root/'font-alternatives.docx')
    build('Times New Roman',root/'font-alternatives-serif.docx')
