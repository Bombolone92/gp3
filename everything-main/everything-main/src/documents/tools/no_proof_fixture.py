"""Hand-authored OOXML proofing inheritance and mixed-run controls; no font programs."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

def run(text, properties=''):
    return f'<w:r><w:rPr>{properties}</w:rPr><w:t>{text}</w:t></w:r>'

def generate():
    cases = [
        ('ordinary', '', run('Zzqxvble')),
        ('direct', '', run('Zzqxvble', '<w:noProof/>')),
        ('paragraph', '<w:pStyle w:val="Excluded"/>', run('Zzqxvble')),
        ('character', '', run('Zzqxvble', '<w:rStyle w:val="ExcludedChar"/>')),
        ('override', '<w:pStyle w:val="Excluded"/>', run('Zzqxvble', '<w:noProof w:val="0"/>')),
        ('mixed', '', run('Zzqx', '<w:noProof/>') + run('vble')),
        ('split', '', run('Zzqx') + run('vble')),
        ('derived', '', run('Zzqxvble', '<w:rStyle w:val="DerivedChar"/>')),
        ('characterOff', '', run('Zzqxvble', '<w:rStyle w:val="CheckedChar"/>')),
    ]
    body = ''.join(f'<w:p><w:pPr>{p}</w:pPr>{r}</w:p>' for _, p, r in cases)
    parts = {
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
        '_rels/.rels': f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/_rels/document.xml.rels': f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{R}/styles" Target="styles.xml"/></Relationships>',
        'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
        'word/styles.xml': f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Excluded"><w:name w:val="Excluded"/><w:basedOn w:val="Normal"/><w:rPr><w:noProof/></w:rPr></w:style><w:style w:type="character" w:styleId="ExcludedChar"><w:name w:val="Excluded character"/><w:rPr><w:noProof/></w:rPr></w:style><w:style w:type="character" w:styleId="DerivedChar"><w:name w:val="Derived excluded character"/><w:basedOn w:val="ExcludedChar"/><w:rPr><w:noProof/></w:rPr></w:style><w:style w:type="character" w:styleId="CheckedChar"><w:name w:val="Checked character"/><w:basedOn w:val="ExcludedChar"/><w:rPr><w:noProof w:val="false"/></w:rPr></w:style></w:styles>',
    }
    target = ROOT / 'tests/fixtures/no-proof/control.docx'
    target.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
        for name, text in parts.items():
            archive.writestr(name, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + text)
    print(target)

if __name__ == '__main__':
    generate()
