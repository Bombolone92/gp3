"""Original header/footer cached-field recovery controls with live page fields."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import image_recovery_fixture as base

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/story-field-recovery'


def run(text):
    return f'<w:r><w:t xml:space="preserve">{text}</w:t></w:r>'


def complex_field(instruction, content):
    return f'<w:r><w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> {instruction} </w:instrText><w:fldChar w:fldCharType="separate"/></w:r>{content}<w:r><w:fldChar w:fldCharType="end"/></w:r>'


def main():
    base.OUT = OUT
    base.build(False)
    with ZipFile(OUT / 'healthy.docx') as archive:
        original = {name: archive.read(name) for name in archive.namelist()}
    for variant in ['healthy', 'simple', 'complex', 'nested', 'combined']:
        parts = dict(original)
        doc = parts['word/document.xml'].decode().replace('<w:sectPr>', base.p('Second body page', '<w:pPr><w:pageBreakBefore/></w:pPr>') + '<w:sectPr>').replace('<w:pgSz', '<w:footerReference w:type="default" r:id="footer"/><w:pgSz')
        if variant == 'combined':
            doc = doc.replace(base.p('Between the pictures'), base.p('Between the pictures', '<w:pPr><w:shd w:val="diagCross" w:fill="FFFFFF" w:color="000000"/></w:pPr>'))
        parts['word/document.xml'] = doc.encode()
        parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].decode().replace('</Relationships>', f'<Relationship Id="footer" Type="{base.R}/footer" Target="footer1.xml"/></Relationships>').encode()
        parts['[Content_Types].xml'] = parts['[Content_Types].xml'].decode().replace('</Types>', '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>').encode()
        for kind, tag, number in [('header', 'hdr', 10), ('footer', 'ftr', 20)]:
            date = '<w:r><w:rPr><w:i/></w:rPr><w:t>September 29, 2026</w:t></w:r>'
            picture = base.picture(number).replace(f'r:embed="image{number}"', 'r:embed="image1"')
            page = complex_field('PAGE', run('9'))
            total = f'<w:fldSimple w:instr="NUMPAGES">{run("9")}</w:fldSimple>'
            tail = picture + run(' Page ') + page + run(' of ') + total
            if variant in ['simple', 'combined']:
                date = f'<w:fldSimple w:instr="COMPARE 1 = 1">{date}</w:fldSimple>'
            elif variant == 'complex':
                date = complex_field('COMPARE 1 = 1', date)
            elif variant == 'nested':
                date, tail = complex_field('COMPARE 1 = 1', date + tail), ''
            content = f'<w:p><w:pPr><w:pStyle w:val="Heading"/></w:pPr>{run(kind + " date: ")}{date}{tail}</w:p>'
            parts[f'word/{kind}1.xml'] = f'<w:{tag} xmlns:w="{base.W}" xmlns:r="{base.R}" xmlns:a="{base.A}" xmlns:wp="{base.WP}" xmlns:pic="{base.PIC}">{content}</w:{tag}>'.encode()
            parts[f'word/_rels/{kind}1.xml.rels'] = f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image1" Type="{base.R}/image" Target="media/image1.png"/></Relationships>'.encode()
        with ZipFile(OUT / (variant + '.docx'), 'w', ZIP_DEFLATED) as archive:
            for name, data in parts.items():
                archive.writestr(name, data)


if __name__ == '__main__':
    main()
