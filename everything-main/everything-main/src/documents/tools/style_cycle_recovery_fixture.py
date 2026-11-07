"""Independent OOXML controls: cyclic links versus those links omitted."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/style-cycle-recovery'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'


def main():
    OUT.mkdir(exist_ok=True)
    with ZipFile(ROOT / 'tests/fixtures/style-identity-recovery/healthy.docx') as archive:
        original = {name: archive.read(name) for name in archive.namelist()}

    def style(identity, kind, base='', default=False, color='993366'):
        link = f'<w:basedOn w:val="{base}"/>' if base else ''
        flag = ' w:default="1"' if default else ''
        table = '<w:tblPr><w:shd w:val="clear" w:fill="DBEAFE"/></w:tblPr>' if kind == 'table' else ''
        return f'<w:style w:type="{kind}" w:styleId="{identity}"{flag}><w:name w:val="{identity}"/>{link}<w:rPr><w:b/><w:color w:val="{color}"/></w:rPr>{table}</w:style>'

    variants = {
        'paragraph': [('BadParagraph', 'paragraph')],
        'character': [('BadCharacter', 'character')],
        'table': [('BadTable', 'table')],
        'default': [('CycleDefault', 'paragraph')],
        'self': [('BadParagraph', 'paragraph')],
        'derived': [('CycleBase', 'paragraph')],
        'combined': [('BadParagraph', 'paragraph'), ('BadCharacter', 'character'), ('BadTable', 'table')],
        'companion': [('BadTable', 'table')],
    }
    for variant, selected in variants.items():
        for recovered in [False, True]:
            parts = dict(original)
            extra = ''
            for identity, kind in selected:
                peer = identity if variant == 'self' else identity + 'Peer'
                extra += style(identity, kind, '' if recovered else peer, variant == 'default')
                if peer != identity:
                    extra += style(peer, kind, '' if recovered else identity, color='008800')
            if variant == 'derived':
                extra += style('BadParagraph', 'paragraph', 'CycleBase', color='663399')
            part = 'word/styles.xml'
            if variant == 'companion':
                part = 'word/stylesWithEffects.xml'
                parts[part] = f'<w:styles xmlns:w="{W}"></w:styles>'.encode()
                parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].decode().replace('</Relationships>', '<Relationship Id="effects" Type="http://schemas.microsoft.com/office/2007/relationships/stylesWithEffects" Target="stylesWithEffects.xml"/></Relationships>').encode()
                parts['[Content_Types].xml'] = parts['[Content_Types].xml'].decode().replace('</Types>', '<Override PartName="/word/stylesWithEffects.xml" ContentType="application/vnd.ms-word.stylesWithEffects+xml"/></Types>').encode()
            parts[part] = parts[part].decode().replace('</w:styles>', extra + '</w:styles>').encode()
            name = variant + ('-control' if recovered else '')
            with ZipFile(OUT / f'{name}.docx', 'w', ZIP_DEFLATED) as archive:
                for path, data in parts.items():
                    info = ZipInfo(path, (2026, 1, 1, 0, 0, 0))
                    info.compress_type = ZIP_DEFLATED
                    archive.writestr(info, data)


if __name__ == '__main__':
    main()
