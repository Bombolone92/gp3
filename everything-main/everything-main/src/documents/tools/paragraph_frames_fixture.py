"""Original OOXML controls for framePr placement, style inheritance and grouping."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import sys

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/paragraph-frames'
folder.mkdir(exist_ok=True)
w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
rels = 'http://schemas.openxmlformats.org/package/2006/relationships'
frame = '<w:framePr w:w="2880" w:h="1440" w:hRule="exact" w:wrap="notBeside" w:hAnchor="page" w:vAnchor="page" w:x="2880" w:y="2880"/>'
legacy_inline = '<w:framePr w:hSpace="0" w:wrap="auto" w:vAnchor="margin" w:xAlign="left" w:yAlign="inline"/>'
def paragraph(text, properties=''):
    return '<w:p>' + ('<w:pPr>'+properties+'</w:pPr>' if properties else '') + '<w:r><w:t>'+text+'</w:t></w:r></w:p>'

for name in sys.argv[1:] or ['page', 'margin', 'style', 'grouped', 'different']:
    positioned = frame if name != 'margin' else frame.replace('Anchor="page"', 'Anchor="margin"')
    variants = {
        'around': frame.replace('notBeside', 'around').replace('w:y="2880"', 'w:y="1440"').replace('/>', ' w:hSpace="240" w:vSpace="120"/>'),
        'not-beside': frame.replace('w:y="2880"', 'w:y="1440"').replace('/>', ' w:vSpace="120"/>'),
        'text-anchor': frame.replace('w:vAnchor="page"', 'w:vAnchor="text"').replace('w:y="2880"', 'w:y="0"'),
        'inline': frame.replace('w:vAnchor="page"', 'w:vAnchor="text"').replace('/>', ' w:yAlign="inline"/>'),
        'auto-width': frame.replace(' w:w="2880"', '').replace(' w:h="1440" w:hRule="exact"', ''),
        'zero-width': frame.replace('w:w="2880"', 'w:w="0"').replace(' w:h="1440" w:hRule="exact"', ''),
        'aligned': frame.replace('/>', ' w:xAlign="center" w:yAlign="bottom"/>'),
        'aligned-relative': frame.replace(' w:x="2880" w:y="2880"', '').replace('/>', ' w:xAlign="center" w:yAlign="bottom"/>'),
        'shaded': frame.replace('notBeside', 'none'),
        'footer-shaded': frame.replace('notBeside', 'none'),
        'bordered': frame.replace('notBeside', 'none'),
        'footer-bordered': frame.replace('notBeside', 'none'),
        'cell': frame,
        'terminal-page': frame,
        'terminal-text': frame.replace('w:vAnchor="page"', 'w:vAnchor="text"').replace('w:y="2880"', 'w:y="0"'),
        'terminal-empty-inline': legacy_inline,
        'footer-inline': legacy_inline,
        'footer-page': frame,
        'footer-text': frame.replace('w:vAnchor="page"', 'w:vAnchor="text"').replace('w:y="2880"', 'w:y="0"'),
        'footer-grouped': frame,
        'inline-flow': legacy_inline,
        'footer-inline-text': legacy_inline,
        'cell-inline': legacy_inline,
    }
    positioned = variants.get(name, positioned)
    style = '<w:style w:type="paragraph" w:styleId="FrameStyle"><w:name w:val="Frame style"/><w:pPr>'+positioned+'</w:pPr></w:style>' if name == 'style' else ''
    properties = '<w:pStyle w:val="FrameStyle"/>' if name == 'style' else positioned
    decoration = '<w:pBdr>'+''.join('<w:'+side+' w:val="single" w:sz="8" w:space="0" w:color="000000"/>' for side in ['top','left','bottom','right'])+'</w:pBdr><w:shd w:val="clear" w:fill="CCFFFF"/>'
    if name in ['bordered', 'footer-bordered']: properties += decoration
    if name in ['shaded', 'footer-shaded']: properties += '<w:shd w:val="clear" w:fill="CCFFFF"/>'
    body = paragraph('Healthy before') + paragraph('Framed first line', properties)
    if name in ['grouped', 'different']: body += paragraph('Framed second line', properties if name == 'grouped' else properties.replace('w:h="1440"', 'w:h="1441"'))
    body += paragraph('Healthy after')
    footer = ''
    if name.startswith('terminal-'):
        body = paragraph('Healthy before') + paragraph('' if name == 'terminal-empty-inline' else 'Framed first line', properties)
    if name.startswith('footer-'):
        body = paragraph('Healthy before') + paragraph('Healthy after')
        footer = paragraph('' if name == 'footer-inline' else 'Framed first line', properties)
        if name == 'footer-grouped': footer += paragraph('Framed second line', properties) + paragraph('Healthy after')
    if name == 'bordered': body = paragraph('Healthy before', decoration) + paragraph('Framed first line', properties) + paragraph('Healthy after', decoration)
    if name == 'footer-bordered': footer += paragraph('Healthy after', decoration)
    if name in ['around', 'not-beside']:
        body += paragraph(' '.join('Ordinary wrapping words' for _ in range(30)))
    if name in ['cell', 'cell-inline']:
        body = '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>'+body+'</w:tc></w:tr></w:tbl>'+paragraph('After table')
    body += '<w:sectPr>' + ('<w:footerReference w:type="default" r:id="footer"/>' if footer else '') + '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
    parts = {
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+''.join('<Override PartName="/word/'+part+'.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.'+kind+'+xml"/>' for part, kind in [('document','document.main'),('styles','styles'),('settings','settings')])+'</Types>',
        '_rels/.rels': f'<Relationships xmlns="{rels}"><Relationship Id="document" Type="{r}/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/_rels/document.xml.rels': f'<Relationships xmlns="{rels}"><Relationship Id="styles" Type="{r}/styles" Target="styles.xml"/><Relationship Id="settings" Type="{r}/settings" Target="settings.xml"/></Relationships>',
        'word/document.xml': f'<w:document xmlns:w="{w}" xmlns:r="{r}"><w:body>{body}</w:body></w:document>',
        'word/styles.xml': f'<w:styles xmlns:w="{w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr/></w:pPrDefault></w:docDefaults>{style}</w:styles>',
        'word/settings.xml': f'<w:settings xmlns:w="{w}"/>',
    }
    if footer:
        parts['word/footer.xml'] = f'<w:ftr xmlns:w="{w}">{footer}</w:ftr>'
        parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', '<Override PartName="/word/footer.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>')
        parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>', f'<Relationship Id="footer" Type="{r}/footer" Target="footer.xml"/></Relationships>')
    with ZipFile(folder / (name+'.docx'), 'w', ZIP_DEFLATED) as archive:
        for path, xml in parts.items(): archive.writestr(path, xml)
