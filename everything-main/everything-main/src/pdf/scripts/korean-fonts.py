"""Rebuild bundled Korean TrueType faces with fonttools==4.59.2.

Run from the repository root. Instancing avoids the current PDF writer's broken
CID-keyed CFF subsetting while retaining the upstream Korean glyph coverage.
"""

from hashlib import sha256
from io import BytesIO
from pathlib import Path
from urllib.request import urlopen

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

URL = (
    'https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/'
    'Sans/Variable/TTF/Subset/NotoSansKR-VF.ttf'
)
with urlopen(URL) as response:
    data = response.read()
if sha256(data).hexdigest() != '9e1d729e7e2b36f9ef439da102f8c134c10aabe46f1c843bf0aca5c043b86f76':
    raise ValueError('Unexpected upstream font checksum')

for style, weight in [('Regular', 400), ('Bold', 700)]:
    font = instantiateVariableFont(
        TTFont(BytesIO(data), recalcTimestamp=False),
        {'wght': weight},
        inplace=True,
        updateFontNames=True,
    )
    # fontkit chooses short loca offsets for small PDF subsets. Each source glyph
    # must have even byte length so its copied outline starts on a valid offset.
    font['glyf'].padding = 4
    path = Path(f'public/fonts/NotoSansKR-{style}.ttf')
    font.save(path)
    print(sha256(path.read_bytes()).hexdigest(), path)
