"""Original controls for line-unit paragraph gaps and precedence."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json, argparse
parser = argparse.ArgumentParser()
parser.add_argument('--default-size', type=int, default=12)
parser.add_argument('--automatic', action='store_true')
args = parser.parse_args()
name = 'paragraph-line-units' + (f'-default-{args.default_size}' if args.default_size != 12 else '')
if args.automatic: name = 'paragraph-auto-spacing'
ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
folder = ROOT / 'tests/fixtures' / name
folder.mkdir(parents=True, exist_ok=True)
with ZipFile(ROOT / 'public/fixtures/conditional-row-header.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
if args.default_size != 12:
    # Also test explicit modern compatibility independently of the omitted
    # settings in the main controls.
    parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace(b'</Types>', b'<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>')
    parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace(b'</Relationships>', b'<Relationship Id="rSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>')
    parts['word/settings.xml'] = f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'.encode()
styles = f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="{args.default_size*2}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults>'
configs = [dict(size=s, rule='auto', line=240, units=100) for s in [10, 12, 20, 30]]
configs += [dict(size=12, rule=r, line=l, units=100) for r, l in [('auto', 480), ('exact', 200), ('exact', 600), ('atLeast', 600)]]
configs += [dict(size=12, rule='auto', line=240, units=n) for n in [0, 50, 150]]
configs += [dict(size=12, rule='auto', line=240, units=0, absolute=720), dict(size=12, rule='auto', line=240, units=100, absolute=720)]
configs += [dict(size=12, rule='auto', line=240, units=100, markSize=24), dict(size=24, rule='auto', line=240, units=100, markSize=12)]
configs += [dict(size=12, rule='auto', line=240, units=100, inherited=True)]
configs += [dict(size=12, rule='auto', line=240, units=100, auto='1'), dict(size=24, rule='auto', line=240, units=100, auto='1'), dict(size=12, rule='auto', line=240, units=100, auto='0')]
if args.automatic: configs = configs[-3:]
elif args.default_size != 12: configs = configs[:4]
else: configs = configs[:-3] + configs[-1:]
cases, body = [], ''
for side in ['before', 'after']:
    for cfg in configs:
        i = len(cases); c = dict(id=f'K{i:02}', side=side, **cfg); cases.append(c)
        attrs = f'w:{side}Lines="{c["units"]}"'
        if 'absolute' in c: attrs += f' w:{side}="{c["absolute"]}"'
        if 'auto' in c: attrs += f' w:{side}Autospacing="{c["auto"]}"'
        if c.get('inherited'): styles += f'<w:style w:type="paragraph" w:styleId="S{i}"><w:name w:val="Gap {i}"/><w:pPr><w:spacing {attrs}/></w:pPr></w:style>'
        for j, letter in enumerate('ABCD'):
            target = j == (2 if side == 'before' else 1)
            style = f'<w:pStyle w:val="S{i}"/>' if target and c.get('inherited') else ''
            page = '<w:pageBreakBefore/>' if j == 0 and i else ''
            gap = attrs if target and not c.get('inherited') else ''
            mark = c.get('markSize', c['size'])
            props = f'{style}{page}<w:spacing w:line="{c["line"]}" w:lineRule="{c["rule"]}" {gap}/><w:rPr><w:sz w:val="{mark*2}"/></w:rPr>'
            body += f'<w:p><w:pPr>{props}</w:pPr><w:r><w:rPr><w:sz w:val="{c["size"]*2}"/></w:rPr><w:t>K{i:02}{letter}</w:t></w:r></w:p>'
styles += '</w:styles>'
body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:bottom="720" w:left="720" w:right="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()
parts['word/styles.xml'] = styles.encode()
with ZipFile(ROOT / 'public/fixtures' / (name + '.docx'), 'w', ZIP_DEFLATED) as z:
    for n, data in parts.items(): z.writestr(n, data)
(folder / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')
