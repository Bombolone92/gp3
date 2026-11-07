"""Original mixed-content controls for rejected style identity recovery."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import re

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/style-identity-recovery'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'


def main():
    OUT.mkdir(exist_ok=True)
    with ZipFile(ROOT / 'tests/fixtures/style-paragraph-recovery/healthy.docx') as archive:
        original = {name: archive.read(name) for name in archive.namelist()}
    body = original['word/document.xml'].decode()
    added = '<w:p><w:pPr><w:pStyle w:val="BadParagraph"/></w:pPr><w:r><w:rPr><w:rStyle w:val="BadCharacter"/><w:i/></w:rPr><w:t>Retained direct italic</w:t></w:r></w:p>'
    table = re.search(r'<w:tbl>.*?</w:tbl>', body).group().replace('w:val="Accent"', 'w:val="BadTable"').replace('Retained table cell', 'Affected table retains its content')
    original['word/document.xml'] = body.replace('<w:sectPr>', added + table + '<w:sectPr>').encode()

    def style(identity, kind, color, default=False):
        key = '' if identity is None else f' w:styleId="{identity}"'
        default = ' w:default="1"' if default else ''
        # Deliberately conflicting declarations; neither first nor last wins.
        table = f'<w:tblPr><w:shd w:val="clear" w:fill="{color}"/></w:tblPr>' if kind == 'table' else ''
        return f'<w:style w:type="{kind}"{key}{default}><w:name w:val="Rejected style"/><w:rPr><w:color w:val="{color}"/><w:sz w:val="48"/></w:rPr>{table}</w:style>'

    faults = {
        'missing': style(None, 'paragraph', 'FF0000'),
        'paragraph': style('BadParagraph','paragraph','FF0000') + style('BadParagraph','paragraph','00FF00'),
        'character': style('BadCharacter','character','FF0000') + style('BadCharacter','character','00FF00'),
        'default': style('BadDefault','paragraph','FF0000',True) + style('BadDefault','paragraph','00FF00',True),
        'table': style('BadTable','table','FF0000') + style('BadTable','table','00FF00'),
        'cross-type': style('BadParagraph','paragraph','FF0000') + style('BadParagraph','character','00FF00'),
    }
    faults['combined'] = ''.join(faults[name] for name in ['missing','paragraph','character','default','table'])
    faults['companion'] = faults['table']
    faults['companion-only'] = ''
    for variant, extra in {'healthy':'', **faults}.items():
        parts = dict(original)
        parts['word/styles.xml'] = parts['word/styles.xml'].decode().replace('</w:styles>',extra+'</w:styles>').encode()
        if variant in ['companion','companion-only']:
            companion = faults['table'] if variant == 'companion-only' else style('BadTable','table','CC00CC')
            parts['word/stylesWithEffects.xml'] = f'<w:styles xmlns:w="{W}">{companion}</w:styles>'.encode()
            parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].decode().replace('</Relationships>', '<Relationship Id="effects" Type="http://schemas.microsoft.com/office/2007/relationships/stylesWithEffects" Target="stylesWithEffects.xml"/></Relationships>').encode()
            parts['[Content_Types].xml'] = parts['[Content_Types].xml'].decode().replace('</Types>', '<Override PartName="/word/stylesWithEffects.xml" ContentType="application/vnd.ms-word.stylesWithEffects+xml"/></Types>').encode()
        with ZipFile(OUT / f'{variant}.docx','w',ZIP_DEFLATED) as archive:
            for name, data in parts.items():
                info = ZipInfo(name,(2026,1,1,0,0,0)); info.compress_type = ZIP_DEFLATED
                archive.writestr(info,data)


if __name__ == '__main__':
    main()
