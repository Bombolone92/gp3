"""Original mixed-run controls for default and explicit kerning policies."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
from io import BytesIO

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/script-kerning-defaults'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'


def main():
    OUT.mkdir(exist_ok=True)
    with ZipFile(ROOT / 'tests/fixtures/script-size/control.docx') as archive:
        original = {name: archive.read(name) for name in archive.namelist()}
    cases = []
    for defaults in ['absent', 'empty']:
        for mode, enabled in [(15, None), (15, False), (15, True), (14, None), (12, None), (None, None)]:
            name = defaults + '-' + ('omitted' if enabled is None else 'on' if enabled else 'off')
            if mode != 15:
                name += '-mode-' + (str(mode) if mode is not None else 'absent')
            body, rows = [], []
            for family in ['Garamond', 'Arial', 'Times New Roman']:
                for face in ['regular', 'bold', 'italic']:
                    for kern in [None, 0, 1]:
                        runs = []
                        for text, script in [('START ', False), ('TEST', True), (' END', False)]:
                            props = f'<w:rFonts w:ascii="{family}" w:hAnsi="{family}"/>'
                            props += '<w:b/>' if face == 'bold' else '<w:i/>' if face == 'italic' else ''
                            if kern is not None:
                                props += f'<w:kern w:val="{kern * 2}"/>'
                            props += '<w:sz w:val="28"/>'
                            if script:
                                props += '<w:vertAlign w:val="superscript"/>'
                            runs.append(f'<w:r><w:rPr>{props}</w:rPr><w:t xml:space="preserve">{text}</w:t></w:r>')
                        body.append('<w:p><w:pPr><w:spacing w:after="0" w:line="440" w:lineRule="exact"/></w:pPr>' + ''.join(runs) + '</w:p>')
                        rows.append(dict(family=family, face=face, kern=kern, size=14))
            body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
            parts = dict(original)
            parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'.encode()
            default = '<w:docDefaults><w:rPrDefault><w:rPr/></w:rPrDefault></w:docDefaults>' if defaults == 'empty' else ''
            parts['word/styles.xml'] = f'<w:styles xmlns:w="{W}">{default}<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:style></w:styles>'.encode()
            switch = '' if enabled is None else f'<w:compatSetting w:name="enableOpenTypeFeatures" w:uri="http://schemas.microsoft.com/office/word" w:val="{int(enabled)}"/>'
            compatibility = '' if mode is None else f'<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="{mode}"/>'
            parts['word/settings.xml'] = f'<w:settings xmlns:w="{W}"><w:compat>{compatibility}{switch}</w:compat></w:settings>'.encode()
            buffer = BytesIO()
            with ZipFile(buffer, 'w', ZIP_DEFLATED) as archive:
                for path, data in parts.items():
                    info = ZipInfo(path, (2026, 1, 1, 0, 0, 0))
                    info.compress_type = ZIP_DEFLATED
                    archive.writestr(info, data)
            target = OUT / f'{name}.docx'
            data = buffer.getvalue()
            if not target.exists() or target.read_bytes() != data:
                target.write_bytes(data)
            cases.append(dict(name=name, defaults=defaults, compatibilityMode=mode, enabled=enabled, rows=rows))
    (OUT / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')


if __name__ == '__main__':
    main()
