"""Independent rich controls for continuous-section restart recovery."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import image_recovery_fixture as base

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/continuous-numbering-recovery'


def main():
    base.OUT = OUT
    base.build(False)
    with ZipFile(OUT / 'healthy.docx') as archive:
        original = {name: archive.read(name) for name in archive.namelist()}
    for variant in ['healthy', 'restart-zero', 'restart-even', 'restart-odd', 'combined', 'paper-change', 'next-page']:
        parts = dict(original)
        doc = parts['word/document.xml'].decode()
        section = doc[doc.index('<w:sectPr>'):doc.index('</w:sectPr>') + len('</w:sectPr>')]
        start = {'restart-zero': 0, 'restart-even': 10, 'restart-odd': 11}.get(variant, 10)
        second = section.replace('<w:pgSz', ('<w:type w:val="continuous"/>' if variant != 'next-page' else '') + '<w:pgSz')
        if variant != 'healthy':
            second = second.replace('</w:sectPr>', f'<w:pgNumType w:start="{start}"/></w:sectPr>')
        if variant == 'paper-change':
            second = second.replace('w:w="10080"', 'w:w="11000"')
        boundary = lambda properties: f'<w:p><w:pPr>{properties}</w:pPr></w:p>'
        tail = boundary(section) + base.p('After continuous boundary', '<w:pPr><w:pStyle w:val="Heading"/></w:pPr>')
        tail += base.p('Second sheet of continuous section', '<w:pPr><w:pageBreakBefore/></w:pPr>') + boundary(second)
        tail += base.p('Supported restart on separate section') + section.replace('</w:sectPr>', '<w:pgNumType w:start="7"/></w:sectPr>')
        doc = doc.replace(section, tail)
        if variant == 'combined':
            doc = doc.replace(base.p('Between the pictures'), base.p('Between the pictures', '<w:pPr><w:shd w:val="diagCross" w:fill="FFFFFF" w:color="000000"/></w:pPr>'))
        parts['word/document.xml'] = doc.encode()
        parts['word/header1.xml'] = f'<w:hdr xmlns:w="{base.W}"><w:p><w:r><w:t xml:space="preserve">Retained header page </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>9</w:t></w:r></w:fldSimple></w:p></w:hdr>'.encode()
        parts['word/settings.xml'] = f'<w:settings xmlns:w="{base.W}"><w:evenAndOddHeaders/></w:settings>'.encode()
        parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].decode().replace('</Relationships>', f'<Relationship Id="settings" Type="{base.R}/settings" Target="settings.xml"/></Relationships>').encode()
        parts['[Content_Types].xml'] = parts['[Content_Types].xml'].decode().replace('</Types>', '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>').encode()
        # Same rich header on recto and verso makes parity regressions observable.
        parts['word/document.xml'] = parts['word/document.xml'].replace(b'<w:headerReference w:type="default" r:id="header"/>', b'<w:headerReference w:type="default" r:id="header"/><w:headerReference w:type="even" r:id="header"/>')
        with ZipFile(OUT / (variant + '.docx'), 'w', ZIP_DEFLATED) as archive:
            for name, data in parts.items():
                archive.writestr(name, data)


if __name__ == '__main__':
    main()
