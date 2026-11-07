"""Original OOXML controls varying source theme channels by one byte.

No renderer imports or corpus artwork. Fixed ZIP metadata makes the authored
source reproducible. Capture colors in the installed reference application before using an oracle.
"""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import argparse
import json

ROOT = Path(__file__).resolve().parents[1]
BASES = ['4F81BD', '4E81BD', '4F80BD', '4F81BC', 'C0504D', 'BF504D', 'C04F4D', 'C0504C']
VALUES = [12, 14, 21, 44, 85, 99, 128, 139, 159, 229, 248, 254, 255]
KEYS = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'dark2', 'light2']
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
NAME = 'theme-minmax-neighbors-20261004.docx'


def generate(destination, bases=BASES, values=VALUES, source_name=NAME):
    destination.mkdir(parents=True, exist_ok=True)
    cases = []
    body = '<w:tbl><w:tblPr><w:tblW w:w="7200" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' + '<w:gridCol w:w="2400"/>'*3 + '</w:tblGrid>'
    for base, key in zip(bases, KEYS, strict=True):
        for mode in ['shade', 'tint']:
            for value in values:
                label = f'C{len(cases):03d}'
                cases.append(dict(label=label, base=base, theme=key, mode=mode, value=value))
                color = f'w:themeColor="{key}" w:theme{mode.title()}="{value:02X}"'
                paragraph = f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="112233" {color}/><w:sz w:val="20"/></w:rPr><w:t>{label}</w:t></w:r></w:p>'
                body += '<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="400" w:hRule="exact"/></w:trPr>'
                for column in range(3):
                    properties = f'<w:shd w:val="clear" w:fill="112233" w:themeFill="{key}" w:themeFill{mode.title()}="{value:02X}"/>' if column == 1 else f'<w:tcBorders><w:top w:val="single" w:sz="16" w:color="112233" {color}/></w:tcBorders>' if column == 2 else ''
                    body += f'<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/>{properties}</w:tcPr>{paragraph if column == 0 else "<w:p/>"}</w:tc>'
                body += '</w:tr>'
    body += '</w:tbl><w:p/>'
    body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
    scheme = {'dk1': '000000', 'lt1': 'FFFFFF', 'dk2': bases[6], 'lt2': bases[7],
              **{f'accent{i+1}': value for i, value in enumerate(bases[:6])}, 'hlink': '0000FF', 'folHlink': '800080'}
    fonts = ''.join(f'<a:{kind}><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:{kind}>' for kind in ['majorFont', 'minorFont'])
    solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
    theme = f'<a:theme xmlns:a="{A}" name="Original minmax neighbors"><a:themeElements><a:clrScheme name="Controls">' + ''.join(f'<a:{key}><a:srgbClr val="{value}"/></a:{key}>' for key, value in scheme.items()) + f'</a:clrScheme><a:fontScheme name="Arial">{fonts}</a:fontScheme><a:fmtScheme name="Controls"><a:fillStyleLst>{solid*3}</a:fillStyleLst><a:lnStyleLst>' + ('<a:ln>'+solid+'</a:ln>')*3 + '</a:lnStyleLst><a:effectStyleLst>' + '<a:effectStyle><a:effectLst/></a:effectStyle>'*3 + f'</a:effectStyleLst><a:bgFillStyleLst>{solid*3}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>'
    with ZipFile(ROOT/'public/fixtures/empty-table-fragment.docx') as archive:
        parts = {name: archive.read(name) for name in archive.namelist()}
    parts['[Content_Types].xml'] = parts['[Content_Types].xml'].decode().replace('</Types>', '<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>')
    parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].decode().replace('</Relationships>', '<Relationship Id="rIdTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>')
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'
    parts['word/theme/theme1.xml'] = theme
    with ZipFile(destination/source_name, 'w', ZIP_DEFLATED) as archive:
        for name, data in parts.items():
            info = ZipInfo(name, (2026, 10, 4, 3, 40, 0)); info.create_system = 0; info.external_attr = 0o600 << 16
            archive.writestr(info, data, compress_type=ZIP_DEFLATED)
    (destination/'cases.json').write_text(json.dumps(cases, indent=2)+'\n')
    return destination/source_name, len(cases)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=ROOT/'tests/fixtures/theme-minmax-neighbors')
    args = parser.parse_args()
    path, count = generate(args.output_dir)
    print(path, count)
