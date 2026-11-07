"""Independent OOXML controls for preserving page geometry during recovery."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import image_recovery_fixture as base
OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/page-setting-recovery'

def main():
    base.OUT = OUT
    base.build(False)
    with ZipFile(OUT / 'healthy.docx') as z:
        parts = {name: z.read(name) for name in z.namelist()}
    # A distinct first section makes loss of section geometry independently visible.
    document = parts['word/document.xml'].decode()
    first = '<w:p><w:pPr><w:sectPr><w:pgSz w:w="11000" w:h="15000"/><w:pgMar w:top="1300" w:right="1100" w:bottom="1400" w:left="1200" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:pPr><w:r><w:t>First section end</w:t></w:r></w:p>'
    document = document.replace(base.p('Numbered item', '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'), first + base.p('Numbered item', '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'))
    variants = {
        'healthy': ('', ''),
        'mirror': ('<w:mirrorMargins/>', ''),
        'ansi': ('<w:compat><w:useAnsiKerningPairs/></w:compat>', ''),
        'top-spacing': ('<w:compat><w:suppressTopSpacing/></w:compat>', ''),
        'bottom-spacing': ('<w:compat><w:suppressBottomSpacing/></w:compat>', ''),
        'page-spacing': ('<w:compat><w:suppressSpacingAtTopOfPage/></w:compat>', ''),
        'rtl-gutter': ('', '<w:rtlGutter/>'),
        'vertical': ('', '<w:textDirection w:val="tbRl"/>'),
        'combined': ('<w:mirrorMargins/><w:compat><w:suppressTopSpacing/><w:useAnsiKerningPairs/></w:compat>', '<w:textDirection w:val="tbRl"/><w:rtlGutter/>'),
        'inactive': ('<w:mirrorMargins w:val="0"/><w:compat><w:suppressTopSpacing w:val="0"/><w:useAnsiKerningPairs w:val="0"/></w:compat>', '<w:rtlGutter w:val="0"/>'),
    }
    for name, (settings, section) in variants.items():
        current = dict(parts)
        current['word/document.xml'] = document.replace('</w:sectPr>', section + '</w:sectPr>').encode()
        current['word/settings.xml'] = f'<w:settings xmlns:w="{base.W}">{settings}</w:settings>'.encode()
        current['word/_rels/document.xml.rels'] = current['word/_rels/document.xml.rels'].decode().replace('</Relationships>', f'<Relationship Id="settings" Type="{base.R}/settings" Target="settings.xml"/></Relationships>').encode()
        current['[Content_Types].xml'] = current['[Content_Types].xml'].decode().replace('</Types>', '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>').encode()
        with ZipFile(OUT / (name + '.docx'), 'w', ZIP_DEFLATED) as z:
            for path, data in current.items(): z.writestr(path, data)
if __name__ == '__main__': main()
