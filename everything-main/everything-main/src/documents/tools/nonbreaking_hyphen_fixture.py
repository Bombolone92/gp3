"""Original mixed-run controls for w:noBreakHyphen versus literal U+2011."""
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import clearing_break_recovery_fixture as base
from canvas_first_section_fixture import parts as skeleton, W

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/nonbreaking-hyphen'


def write_parts(name, parts):
    output = BytesIO()
    with ZipFile(output, 'w') as archive:
        for part, data in parts.items():
            info = ZipInfo(part, date_time=(2026, 1, 1, 0, 0, 0)); info.compress_type = ZIP_DEFLATED
            archive.writestr(info, data)
    target = OUT / name
    data = output.getvalue()
    if not target.exists() or target.read_bytes() != data:
        target.write_bytes(data)


def build():
    with TemporaryDirectory() as temporary:
        base.OUT = Path(temporary)
        base.build()
        originals = {}
        for position in ['before', 'after', 'both']:
            with ZipFile(base.OUT / f'{position}-none.docx') as archive:
                originals[position] = {n: archive.read(n) for n in archive.namelist()}
    OUT.mkdir(parents=True, exist_ok=True)
    for position, original in originals.items():
        for kind, marker in [('element', '<w:noBreakHyphen/>'), ('unicode', '<w:t>\u2011</w:t>')]:
            parts = dict(original)
            for name in ['word/document.xml', 'word/header1.xml', 'word/footer1.xml']:
                xml = parts[name].decode().replace('<w:br w:type="textWrapping" w:clear="none"/>', marker)
                # Force a narrow line where a discretionary hyphen break would
                # fit, but a nonbreaking hyphen must keep the compound intact.
                if name == 'word/document.xml':
                    narrow = '<w:p><w:pPr><w:ind w:right="6200"/></w:pPr><w:r><w:t xml:space="preserve">X example</w:t>' + marker + '<w:t>word tail</w:t></w:r></w:p>'
                    xml = xml.replace('<w:sectPr>', narrow + '<w:sectPr>')
                parts[name] = xml.encode()
            styles = parts['word/styles.xml'].decode().replace('<w:style ', '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style ', 1)
            parts['word/styles.xml'] = styles.encode()
            write_parts(f'{position}-{kind}.docx', parts)

    # A compound fits on a line, but its prefix plus compound does not. The
    # ASCII form may break at the hyphen; noBreakHyphen must move the compound.
    body = ''
    for font in ['Arial', 'Times New Roman']:
        for kind, marker in [('element', '<w:noBreakHyphen/>'), ('ascii', '<w:t>-</w:t>'), ('unicode', '<w:t>\u2011</w:t>')]:
            props = f'<w:rPr><w:rFonts w:ascii="{font}" w:hAnsi="{font}"/><w:sz w:val="24"/></w:rPr>'
            body += f'<w:p><w:r>{props}<w:t>{font}: {kind}</w:t></w:r></w:p>'
            body += '<w:p><w:pPr><w:spacing w:after="240"/><w:ind w:right="7200"/></w:pPr>'
            body += f'<w:r>{props}<w:t xml:space="preserve">Prefix example</w:t>{marker}<w:t>word tail</w:t></w:r></w:p>'
    body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
    parts = dict(skeleton)
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'
    write_parts('semantics.docx', parts)


if __name__ == '__main__':
    build()
