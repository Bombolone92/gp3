"""Verify original device-bound/sizing controls and record bounded reference origins."""
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
import argparse, json, math, struct
from fontTools.ttLib import TTFont
from script_vdmx_fixture import tables, checksum
from record_script_position_metafiles import capture, verify_gdi, sha

ROOT = Path(__file__).resolve().parents[1]
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
FOLDERS = ['script-vdmx-ppem', 'script-device-caps', 'script-size-offset', 'script-sub-offset', 'script-sub-offset-threshold']


def verify_source(folder, cases):
    original = tables((ROOT/'public/fonts/BebasNeue-Regular.ttf').read_bytes())
    fonts = json.loads((folder/'fonts.json').read_text())
    assert fonts == [case['family'].replace(' ', '')+'.ttf' for case in cases]
    with ZipFile(folder/'controls.docx') as package:
        assert set(package.namelist()) == {'[Content_Types].xml', '_rels/.rels', 'word/document.xml'}
        paragraphs = ET.fromstring(package.read('word/document.xml')).find(W+'body').findall(W+'p')
    assert len(paragraphs) == sum(1+len(case['rows']) for case in cases)
    paragraph_index = 0
    for index, case in enumerate(cases):
        label = paragraphs[paragraph_index]
        assert ''.join(label.itertext()) == case['family']
        assert (label.find(W+'pPr/'+W+'pageBreakBefore') is not None) == (index>0)
        for paragraph, row in zip(paragraphs[paragraph_index+1:paragraph_index+1+len(case['rows'])], case['rows'], strict=True):
            runs = paragraph.findall(W+'r')
            assert [r.find(W+'t').text for r in runs] == ['START ', 'TEST', ' END']
            for j, run in enumerate(runs):
                props = run.find(W+'rPr')
                assert props.find(W+'rFonts').attrib == {W+'ascii':case['family'], W+'hAnsi':case['family']}
                assert props.find(W+'sz').get(W+'val') == f'{row["size"]*2:g}'
                align = props.find(W+'vertAlign')
                assert (align is None) if j!=1 else align.get(W+'val') == row['script']
        paragraph_index += 1+len(case['rows'])
        data = (folder/fonts[index]).read_bytes(); current = tables(data)
        assert checksum(data) == 0xb1b0afba
        fields = {16:700, 24:700} if folder.name != 'script-size-offset' else {20:case['sizeMetric'], 24:case['offsetMetric']}
        if folder.name.startswith('script-sub-offset'): fields = {16:case['subOffsetMetric'], 20:case['sizeMetric'], 24:350}
        if folder.name == 'script-sub-offset-threshold': fields[12] = 500
        if case.get('kind') == 'superSize': fields[20] = case['value']
        expected_os2 = bytearray(original[b'OS/2'])
        for offset, value in fields.items(): struct.pack_into('>h', expected_os2, offset, value)
        assert current[b'OS/2'] == expected_os2
        for tag in original:
            if tag not in [b'name', b'head', b'OS/2', b'DSIG']: assert current[tag] == original[tag], tag
        assert current[b'head'][:8] == original[b'head'][:8] and current[b'head'][12:] == original[b'head'][12:]
        has_vdmx = folder.name == 'script-vdmx-ppem' or case.get('kind') == 'ascentDelta'
        assert set(current) == set(original)-{b'DSIG'} | ({b'VDMX'} if has_vdmx else set())
        with TTFont(folder/fonts[index]) as font:
            if has_vdmx:
                v = font['VDMX']
                assert v.version == 1 and len(v.groups) == 1
                assert v.ratRanges == [dict(bCharSet=1, xRatio=0, yStartRatio=0, yEndRatio=0, groupIndex=0)]
                group = v.groups[0]
                assert set(group) == set(range(1, 256))
                for ppem in group:
                    delta = case['ascentDelta'] if folder.name == 'script-vdmx-ppem' and ppem == case['ppem'] else case['value'] if case.get('kind') == 'ascentDelta' and ppem == 83 else 0
                    assert group[ppem] == (math.ceil(.95*ppem)+delta, -math.ceil(.35*ppem))
    return fonts


def record(folder):
    cases = json.loads((folder/'cases.json').read_text())
    fonts = verify_source(folder, cases)
    provenance = json.loads((folder/'native-capture.json').read_text(encoding='utf-8-sig'))
    assert provenance['sourceUnchanged'] and provenance['readOnly']
    assert provenance['sourceSha256'] == sha((folder/'controls.docx').read_bytes())
    names = [f'native-font-{i}.emf' for i in range(1, len(cases)+1)]
    assert set(provenance['captures']) == set(names)
    results = []
    for index, case in enumerate(cases):
        data = (folder/names[index]).read_bytes()
        assert sha(data) == provenance['captures'][names[index]]
        actual, descriptions = capture(data, case, quantized_frame=True,
                                       zero_subscript_offset=folder.name == 'script-sub-offset' and case['subOffsetMetric'] == 0)
        selected = verify_gdi((folder/fonts[index]).read_bytes(), descriptions)
        results.append(dict(case, **actual, reselectedFontTables=selected))
    bound = ['controls.docx', 'cases.json', 'fonts.json', 'native-capture.json', *fonts, *names]
    result = dict(referenceBuild=provenance['referenceBuild'], capture='Range.EnhMetaFileBits',
                  hashes={name:sha((folder/name).read_bytes()) for name in bound},
                  baseFontSha256=sha((ROOT/'public/fonts/BebasNeue-Regular.ttf').read_bytes()), cases=results)
    (folder/'reference.json').write_text(json.dumps(result, indent=2)+'\n')
    print(folder.name, sum(len(case['rows']) for case in results), 'native rows verified')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder', choices=FOLDERS, action='append')
    args = parser.parse_args()
    for name in args.folder or FOLDERS: record(ROOT/'tests/fixtures'/name)


if __name__ == '__main__': main()
