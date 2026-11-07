"""Original font-file controls; rename reviewed OFL faces without altering glyphs."""
from pathlib import Path
from struct import pack, unpack_from
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo
from xml.sax.saxutils import escape
import hashlib, json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/font-files'
FAMILY = 'Corpus File Font'
FORMS = [('Regular', 'SourceSansPro-Regular.ttf', ''), ('Bold', 'SourceSansPro-Bold.ttf', '<w:b/>'),
         ('Italic', 'SourceSansPro-It.ttf', '<w:i/>'), ('BoldItalic', 'SourceSansPro-BoldIt.ttf', '<w:b/><w:i/>')]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
P = 'http://schemas.openxmlformats.org/package/2006/relationships'

def checksum(data):
    data += b'\0' * (-len(data) % 4)
    return sum(unpack_from('>' + 'I' * (len(data)//4), data)) & 0xffffffff

def renamed_font(data, form):
    count = unpack_from('>H', data, 4)[0]
    tables = {}
    for i in range(count):
        tag, _, at, size = unpack_from('>4sIII', data, 12 + i*16)
        tables[tag] = bytearray(data[at:at+size])
    names = tables[b'name']
    _, total, storage = unpack_from('>HHH', names)
    records, strings = [], bytearray()
    for i in range(total):
        platform, encoding, language, name_id, size, at = unpack_from('>6H', names, 6 + i*12)
        text = bytes(names[storage+at:storage+at+size])
        if name_id in (1, 2, 3, 4, 6, 16, 17):
            replacement = {1:FAMILY, 2:form, 3:'CorpusFileFont-' + form, 4:FAMILY + (' ' + form if form != 'Regular' else ''), 6:'CorpusFileFont-' + form, 16:FAMILY, 17:form}[name_id]
            text = replacement.encode('utf-16-be' if platform in (0, 3) else 'mac_roman')
        records.append(pack('>6H', platform, encoding, language, name_id, len(text), len(strings)))
        strings.extend(text)
    tables[b'name'] = bytearray(pack('>3H', 0, len(records), 6 + 12*len(records)) + b''.join(records) + strings)
    tables[b'head'][8:12] = b'\0'*4
    output = bytearray(data[:12] + b'\0'*(count*16))
    head_at = 0
    for i, (tag, table) in enumerate(sorted(tables.items())):
        output.extend(b'\0' * (-len(output)%4))
        at = len(output)
        output[12+i*16:28+i*16] = pack('>4sIII', tag, checksum(bytes(table)), at, len(table))
        output.extend(table)
        if tag == b'head': head_at = at
    output[head_at+8:head_at+12] = pack('>I', (0xb1b0afba-checksum(bytes(output))) & 0xffffffff)
    return bytes(output)

def document(fonts, embedded, readonly=False):
    body = ''.join(f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="300" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="{FAMILY}" w:hAnsi="{FAMILY}"/>{style}<w:sz w:val="28"/></w:rPr><w:t>{n+1} Hamburg AVATAR office Wide iii WWW 0123456789</w:t></w:r></w:p>' for n, (_, _, style) in enumerate(FORMS))
    parts = {
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/></Types>',
        '_rels/.rels': f'<Relationships xmlns="{P}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/document.xml': f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
        'word/_rels/document.xml.rels': f'<Relationships xmlns="{P}"><Relationship Id="fonts" Type="{R}/fontTable" Target="fontTable.xml"/></Relationships>',
    }
    embeds, rels = [], []
    if embedded:
        key = '{00112233-4455-6677-8899-AABBCCDDEEFF}'
        octets = bytes.fromhex(key.strip('{}').replace('-', ''))[::-1]
        for i, ((form, _, _), data) in enumerate(zip(FORMS, fonts)):
            data = bytearray(data)
            for j in range(32): data[j] ^= octets[j%16]
            parts[f'word/fonts/face{i}.odttf'] = data
            embeds.append(f'<w:embed{form} r:id="font{i}" w:fontKey="{key}" w:subsetted="false"/>')
            rels.append(f'<Relationship Id="font{i}" Type="{R}/font" Target="fonts/face{i}.odttf"/>')
        parts['word/_rels/fontTable.xml.rels'] = f'<Relationships xmlns="{P}">{"".join(rels)}</Relationships>'
    parts['word/fontTable.xml'] = f'<w:fonts xmlns:w="{W}" xmlns:r="{R}"><w:font w:name="{FAMILY}">{"".join(embeds)}</w:font></w:fonts>'
    if readonly:
        parts['word/document.xml'] = parts['word/document.xml'].replace('</w:sectPr>', '<w:pgBorders><w:top w:val="handmade1" w:sz="21" w:space="12"/></w:pgBorders></w:sectPr>')
    with ZipFile(OUT / ('readonly.docx' if readonly else 'embedded.docx' if embedded else 'control.docx'), 'w') as z:
        for name, data in parts.items():
            entry = ZipInfo(name, (2026, 9, 30, 0, 0, 0)); entry.compress_type = ZIP_DEFLATED
            z.writestr(entry, data.encode() if isinstance(data, str) else data)

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    fonts = []
    for form, filename, _ in FORMS:
        data = renamed_font((ROOT / 'public/fonts' / filename).read_bytes(), form)
        (OUT / f'{form}.ttf').write_bytes(data); fonts.append(data)
    document(fonts, False); document(fonts, True); document(fonts, False, True)
    (OUT / 'source-hashes.json').write_text(json.dumps({p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in OUT.glob('*.ttf')}, indent=2)+'\n')
