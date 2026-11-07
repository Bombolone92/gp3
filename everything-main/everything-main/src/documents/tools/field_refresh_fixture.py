"""Original PAGEREF caches: distinguish opening, printing and explicit refresh."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import sys

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/field-refresh'
folder.mkdir(exist_ok=True)
w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
rels = 'http://schemas.openxmlformats.org/package/2006/relationships'
def text(value):
    return '<w:r><w:t xml:space="preserve">'+value+'</w:t></w:r>'
def field(value, flags=''):
    return '<w:r><w:fldChar w:fldCharType="begin" '+flags+'/></w:r><w:r><w:instrText xml:space="preserve"> PAGEREF Target </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>'+text(value)+'<w:r><w:fldChar w:fldCharType="end"/></w:r>'
content = [text('Simple: ')+'<w:fldSimple w:instr=" PAGEREF Target ">'+text('99')+'</w:fldSimple>',
           text('Complex: ')+field('88'), text('Dirty: ')+field('77','w:dirty="true"'),
           text('Locked: ')+field('66','w:fldLock="true"')]
body = ''.join('<w:p>'+s+'</w:p>' for s in content)
body += '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:bookmarkStart w:id="0" w:name="Target"/>'+text('Target on page two')+'<w:bookmarkEnd w:id="0"/></w:p>'
body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
cases = [('switches','true')] if '--switches-only' in sys.argv else [('absent',None),('false','false'),('true','true')]
for name, update in cases:
    current_body = body
    if name == 'switches':
        current_body = current_body.replace('w:instr=" PAGEREF Target "', 'w:instr=" PAGEREF Target \\h \\p "', 1)
        current_body = current_body.replace('> PAGEREF Target <', '> PAGEREF Target \\* ROMAN <', 1)
        current_body = current_body.replace('> PAGEREF Target <', '> PAGEREF Target \\unsupported <', 1)
    parts = {
        '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+''.join('<Override PartName="/word/'+part+'.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.'+kind+'+xml"/>' for part,kind in [('document','document.main'),('styles','styles'),('settings','settings')])+'</Types>',
        '_rels/.rels':f'<Relationships xmlns="{rels}"><Relationship Id="document" Type="{r}/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/_rels/document.xml.rels':f'<Relationships xmlns="{rels}"><Relationship Id="styles" Type="{r}/styles" Target="styles.xml"/><Relationship Id="settings" Type="{r}/settings" Target="settings.xml"/></Relationships>',
        'word/document.xml':f'<w:document xmlns:w="{w}"><w:body>{current_body}</w:body></w:document>',
        'word/styles.xml':f'<w:styles xmlns:w="{w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr/></w:pPrDefault></w:docDefaults></w:styles>',
        'word/settings.xml':f'<w:settings xmlns:w="{w}">'+('' if update is None else f'<w:updateFields w:val="{update}"/>')+'</w:settings>',
    }
    with ZipFile(folder/f'{name}.docx','w',ZIP_DEFLATED) as archive:
        for path,xml in parts.items(): archive.writestr(path,xml)
