"""Independent numbering-index recovery controls; no application serializer."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import re

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/numbering-level-recovery'
BASE = OUT.parent / 'numbering-definition-recovery/healthy.docx'

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with ZipFile(BASE) as archive:
        original = {name: archive.read(name) for name in archive.namelist()}
    level = '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/><w:lvlJc w:val="left"/></w:lvl>'
    override = '<w:lvlOverride w:ilvl="1"><w:startOverride w:val="5"/></w:lvlOverride>'
    variants = {
        'healthy': ('', ''),
        'duplicate-level': (level + level.replace('w:ilvl="1"', 'w:ilvl="01"'), ''),
        'missing-level-index': (level.replace(' w:ilvl="1"', ''), ''),
        'invalid-level-index': (level.replace('w:ilvl="1"', 'w:ilvl="9"'), ''),
        'duplicate-override': (level, override + override.replace('w:ilvl="1"', 'w:ilvl="01"')),
        'missing-override-index': ('', override.replace(' w:ilvl="1"', '')),
        'invalid-override-index': ('', override.replace('w:ilvl="1"', 'w:ilvl="bogus"')),
        'mismatch-override': (level, '<w:lvlOverride w:ilvl="1">' + level.replace('w:ilvl="1"', 'w:ilvl="2"') + '</w:lvlOverride>'),
        'invalid-start': (level, override.replace('w:val="5"', 'w:val="bogus"')),
    }
    for name, (levels, overrides) in variants.items():
        parts = dict(original)
        numbering = parts['word/numbering.xml'].decode()
        # Keep only abstract 0 / instance 1, shared by healthy and affected items.
        numbering = re.sub(r'<w:abstractNum w:abstractNumId="1">.*?</w:abstractNum>', '', numbering)
        numbering = re.sub(r'<w:num w:numId="2">.*?</w:num>', '', numbering)
        numbering = numbering.replace('</w:abstractNum>', levels + '</w:abstractNum>')
        numbering = numbering.replace('</w:num>', overrides + '</w:num>')
        parts['word/numbering.xml'] = numbering.encode()
        if name != 'healthy':
            for part in ['word/document.xml', 'word/header1.xml']:
                parts[part] = parts[part].decode().replace('<w:pStyle w:val="Heading"/><w:spacing', '<w:pStyle w:val="Heading"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr><w:spacing').encode()
        with ZipFile(OUT / (name + '.docx'), 'w', ZIP_DEFLATED) as archive:
            for part, data in parts.items(): archive.writestr(part, data)

if __name__ == '__main__': main()
