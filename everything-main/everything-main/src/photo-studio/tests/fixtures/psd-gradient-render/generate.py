"""Create original gradient-interpolation probes using MIT psd-tools and Pillow.

Usage: python generate.py /tmp/gradient-probes
All pixels, definitions and parameters are original controlled test data.
"""
from pathlib import Path
from PIL import Image
from psd_tools import PSDImage
from psd_tools.api.layers import PixelLayer
from psd_tools.constants import Tag, Compression
from psd_tools.psd.tagged_blocks import TaggedBlock
from psd_tools.psd.descriptor import DescriptorBlock, Double, Integer, UnitFloat, Bool
from psd_tools.terminology import Unit
import copy
import sys
source = DescriptorBlock.frombytes(
    (Path(__file__).parent.parent / 'psd-gradient-fills' / 'full.bin').read_bytes()
)
source.pop(b'gradientsInterpolationMethod')
source[b'Type'].enum = b'Lnr '
source[b'Dthr'] = Bool(False)
source[b'Algn'] = Bool(False)
source[b'Angl'] = UnitFloat(0,Unit.Angle)
source[b'Scl '] = UnitFloat(100,Unit.Percent)
source[b'Ofst'][b'Hrzn'] = UnitFloat(0,Unit.Percent)
source[b'Ofst'][b'Vrtc'] = UnitFloat(0,Unit.Percent)
source[b'Grad'][b'Clrs'].pop(1)
source[b'Grad'][b'Trns'].pop(1)
for i, s in enumerate(source[b'Grad'][b'Clrs']):
    for k in [b'Rd  ', b'Grn ', b'Bl  ']:
        s[b'Clr '][k] = Double(i * 255)
    s[b'Lctn'] = Integer(i*4096)
    s[b'Mdpn'] = Integer(50)
    s[b'Type'].enum = b'UsrS'
for i, s in enumerate(source[b'Grad'][b'Trns']):
    s[b'Opct'] = UnitFloat(100,Unit.Percent)
    s[b'Lctn'] = Integer(i*4096)
    s[b'Mdpn'] = Integer(50)
root = Path(sys.argv[1])
root.mkdir(parents = True, exist_ok = True)
for samples in [0, 1024, 2048, 4096]:
    for midpoint in [25, 50, 75]:
        d = copy.deepcopy(source)
        d[b'Grad'][b'Intr'] = Double(samples)
        d[b'Grad'][b'Clrs'][0][b'Mdpn'] = Integer(midpoint)
        psd = PSDImage.new('RGB',(129,9),color = (255,255,255),depth = 8)
        l = PixelLayer.frompil(
            Image.new('RGB', (129, 9), (255, 0, 255)), psd,
            'Controlled gradient', compression = Compression.RLE,
        )
        l.tagged_blocks[Tag.GRADIENT_FILL_SETTING] = TaggedBlock(key = Tag.GRADIENT_FILL_SETTING,data = d)
        psd.save(root/f'classic-{samples}-{midpoint}.psd')
for midpoint in [25, 75]:
    psd = PSDImage.open(root/'classic-4096-50.psd')
    d = psd[0].tagged_blocks.get_data(Tag.GRADIENT_FILL_SETTING)
    d[b'Grad'][b'Clrs'][1][b'Mdpn'] = Integer(midpoint)
    psd.save(root/f'classic-4096-right-{midpoint}.psd')
print('Generated 14 controlled gradient definitions with deliberately stale magenta cached pixels.')
