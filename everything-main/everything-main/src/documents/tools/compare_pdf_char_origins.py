"""Read PDFium character origins to compare horizontal non-whitespace text.

No fonts are extracted. This is a text-placement diagnostic, not a visual
fidelity certificate. Whitespace origins, rotated text, art and text omitted
from the caller's line list are outside its scope. PDFium may infer whitespace;
By default Unicode identities must match exactly. Optional control-code pairing
retains each unknown native identity and marks it unverified; it never substitutes
an expected character. The input/output reports may contain private source text.
"""
from pathlib import Path
import argparse
import ctypes
import hashlib
import json
import math


def horizontal_matrix(matrix):
    # Synthetic italic shear changes c, not the horizontal baseline a/b.
    return matrix.a > 0 and abs(matrix.b) <= 1e-5


def read_chars(path):
    import pypdfium2 as pdfium
    result = []
    with pdfium.PdfDocument(path) as document:
        for number in range(len(document)):
            page = document[number]; text = page.get_textpage()
            try:
                chars = []
                for index in range(text.count_chars()):
                    code = pdfium.raw.FPDFText_GetUnicode(text.raw, index)
                    if not code or code > 0x10ffff or chr(code).isspace():
                        continue
                    matrix = pdfium.raw.FS_MATRIX()
                    if not pdfium.raw.FPDFText_GetMatrix(text.raw, index, ctypes.byref(matrix)):
                        raise ValueError('Missing native character matrix')
                    if not horizontal_matrix(matrix):
                        continue
                    x = ctypes.c_double(); y = ctypes.c_double()
                    if not pdfium.raw.FPDFText_GetCharOrigin(text.raw, index, ctypes.byref(x), ctypes.byref(y)):
                        raise ValueError('Missing native character origin')
                    if not math.isfinite(x.value) or not math.isfinite(y.value):
                        raise ValueError('Invalid native character origin')
                    chars.append(dict(index=index, text=chr(code), x=x.value, y=page.get_height()-y.value))
                result.append(chars)
            finally:
                text.close(); page.close()
    return result


def read_metadata_chars(path, *, include_font_metadata=False):
    """Interpret PDF text operators/ToUnicode without decoding font programs.

    This explicit alternative retains PDF-declared Unicode, widths and origins;
    it never substitutes expected source characters or a glyph-outline guess.
    Optional font metadata records declared text-state values, not a measured
    glyph size or a rule for the source document's layout font size.
    """
    from pdfminer.pdfinterp import PDFResourceManager, PDFPageInterpreter
    from pdfminer.pdfdevice import PDFTextDevice
    from pdfminer.pdfpage import PDFPage
    from pdfminer.pdftypes import dict_value
    from pdfminer.psparser import literal_name

    class MetadataFonts(PDFResourceManager):
        def get_font(self, objid, spec):
            safe = dict(spec)
            if 'FontDescriptor' in safe:
                descriptor = dict(dict_value(safe['FontDescriptor']))
                for key in ('FontFile', 'FontFile2', 'FontFile3'):
                    descriptor.pop(key, None)
                safe['FontDescriptor'] = descriptor
            subtype = literal_name(safe.get('Subtype'))
            if subtype in ('CIDFontType0', 'CIDFontType2') and 'ToUnicode' not in safe:
                raise ValueError('Metadata-only reader requires explicit ToUnicode for this font')
            if subtype == 'Type3':
                raise ValueError('Metadata-only reader does not interpret Type3 glyph programs')
            # Type0 recursively calls this override for its descendant font.
            return super().get_font(objid, safe)

    class Origins(PDFTextDevice):
        def begin_page(self, page, ctm):
            if page.rotate:
                raise ValueError('Metadata-only reader does not support rotated PDF pages')
            self.height = page.mediabox[3] - page.mediabox[1]
            self.chars = []; self.index = 0

        def render_char(self, matrix, font, fontsize, scaling, rise, cid, ncs, graphicstate):
            text = font.to_unichr(cid)
            if len(text) != 1:
                raise ValueError('Metadata-only reader cannot split a multi-character glyph mapping')
            a, b, c, d, e, f = matrix
            x, y = e + c * rise, self.height - (f + d * rise)
            if not all(math.isfinite(value) for value in (x, y)):
                raise ValueError('Invalid PDF text operator origin')
            if not font.is_vertical() and a > 0 and abs(b) <= 1e-5 and not text.isspace():
                char = dict(index=self.index, text=text, x=x, y=y)
                if include_font_metadata:
                    name = font.fontname
                    if isinstance(name, bytes):
                        name = name.decode('latin-1')
                    char['fontMetadata'] = dict(name=name, declaredSize=fontsize,
                                                horizontalScaling=scaling,
                                                textMatrix=[a, b, c, d])
                self.chars.append(char)
            self.index += 1
            return font.char_width(cid) * fontsize * scaling

    manager = MetadataFonts(); device = Origins(manager)
    interpreter = PDFPageInterpreter(manager, device); result = []
    try:
        with open(path, 'rb') as stream:
            for page in PDFPage.get_pages(stream):
                interpreter.process_page(page); result.append(device.chars)
    finally:
        device.close()
    return result


def compare(lines, pages, radius_x=8, radius_y=3, allow_unknown=False):
    groups = []
    for page in pages:
        rows = []
        for char in sorted(page, key=lambda c: (c['y'], c['x'], c['index'])):
            row = next((r for r in reversed(rows) if abs(r[0]['y']-char['y']) <= .02), None)
            if row is None:
                row = []; rows.append(row)
            row.append(char)
        for row in rows:
            row.sort(key=lambda c: (c['x'], c['index']))
        groups.append(rows)
    used = [set() for page in pages]; matched = []; unmatched = []
    for line in lines:
        chars = line['chars']; page = line['page']-1
        if not chars:
            continue
        segments = []
        for char in chars:
            if not segments or abs(segments[-1][0]['y']-char['y']) > .02:
                segments.append([])
            segments[-1].append(char)
        if len(segments) > 1:
            # Match each display-baseline span against native text, retaining
            # exact identities and global no-reuse. Commit only a whole line.
            remaining = [[c for c in native if c['index'] not in seen] for native, seen in zip(pages, used)]
            pieces = [dict(page=page+1, chars=segment) for segment in segments]
            partial = compare(pieces, remaining, radius_x, radius_y, allow_unknown)
            if partial['unmatchedLines']:
                unmatched.append(dict(page=page+1, text=line.get('text', ''), chars=len(chars), reason='mixed-baseline span unmatched'))
                continue
            errors = [error for piece in partial['matches'] for error in piece['errors']]
            used[page].update(error['nativeIndex'] for error in errors)
            matched.append(dict(page=page+1, text=line.get('text', ''), chars=len(chars), errors=errors,
                                unknownChars=partial['unknownChars'], maxX=partial['maxX'], maxY=partial['maxY']))
            continue
        needle = ''.join(c['text'] for c in chars)
        if any(c.isspace() for c in needle) or not 0 <= page < len(pages):
            raise ValueError('Expected non-whitespace text on an existing page')
        choices = []
        for row in groups[page]:
            if abs(row[0]['y']-chars[0]['y']) > radius_y:
                continue
            haystack = ''.join(c['text'] for c in row)
            if allow_unknown:
                starts = [at for at in range(len(row)-len(chars)+1) if all(
                    expected == actual or ord(actual) < 32 or 127 <= ord(actual) < 160
                    for expected,actual in zip(needle,haystack[at:at+len(chars)]))]
            else:
                starts = []; start = 0
                while (at := haystack.find(needle, start)) >= 0:
                    starts.append(at); start = at+1
            for at in starts:
                native = row[at:at+len(chars)]
                if len(native) != len(chars) or any(c['index'] in used[page] for c in native):
                    continue
                if not any(a['text'] == n['text'] for a,n in zip(chars,native)):
                    continue
                dx = native[0]['x']-chars[0]['x']; dy = native[0]['y']-chars[0]['y']
                if abs(dx) <= radius_x:
                    choices.append((dx*dx+dy*dy, native))
        if not choices:
            unmatched.append(dict(page=page+1, text=line.get('text', needle), chars=len(chars)))
            continue
        choices.sort(key=lambda c: c[0])
        if len(choices) > 1 and abs(choices[0][0]-choices[1][0]) < 1e-8:
            unmatched.append(dict(page=page+1, text=line.get('text', needle), chars=len(chars), reason='ambiguous'))
            continue
        native = choices[0][1]; used[page].update(c['index'] for c in native)
        errors = [dict(text=a['text'], nativeText=n['text'], nativeIndex=n['index'], unicodeVerified=a['text']==n['text'],
                       dx=a['x']-n['x'], dy=a['y']-n['y']) for a,n in zip(chars,native)]
        matched.append(dict(page=page+1, text=line.get('text', needle), chars=len(chars), errors=errors,
                            unknownChars=sum(not c['unicodeVerified'] for c in errors),
                            maxX=max(abs(c['dx']) for c in errors), maxY=max(abs(c['dy']) for c in errors)))
    return dict(matchedLines=len(matched), matchedChars=sum(m['chars'] for m in matched),
                unknownChars=sum(m['unknownChars'] for m in matched),
                unmatchedLines=len(unmatched), unmatchedChars=sum(m['chars'] for m in unmatched),
                nativeUnused=sum(len(page)-len(seen) for page,seen in zip(pages,used)),
                maxX=max((m['maxX'] for m in matched),default=0), maxY=max((m['maxY'] for m in matched),default=0),
                matches=matched, unmatched=unmatched)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf',type=Path); parser.add_argument('app',type=Path); parser.add_argument('output',type=Path)
    parser.add_argument('--allow-unknown',action='store_true',help='Pair control-code glyphs without verifying their Unicode identity.')
    parser.add_argument('--reader', choices=['pdfium', 'metadata'], default='pdfium',
                        help='Read PDFium origins or explicit PDF text operators/ToUnicode with font programs disabled.')
    args = parser.parse_args()
    if args.output.resolve() in (args.pdf.resolve(), args.app.resolve()):
        parser.error('Output must differ from both read-only inputs.')
    app = json.loads(args.app.read_text(encoding='utf-8'))
    reader = read_metadata_chars if args.reader == 'metadata' else read_chars
    result = compare(app['lines'], reader(str(args.pdf)),allow_unknown=args.allow_unknown)
    result['pdfSha256'] = hashlib.sha256(args.pdf.read_bytes()).hexdigest()
    result['appSha256'] = hashlib.sha256(args.app.read_bytes()).hexdigest()
    result['sourceSha256'] = app.get('sourceSha256')
    result['allowUnknown'] = args.allow_unknown
    result['reader'] = args.reader
    args.output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k not in ('matches','unmatched')}))
