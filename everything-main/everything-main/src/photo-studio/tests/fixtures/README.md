`layer-order.psd` is a 4×4 RGB/8 fixture generated with psd-tools 1.20.0
and Pillow 12.3.0, independently of the application's ag-psd codec.
It has a red background below a normal group containing blue, offset green,
and hidden yellow layers. The expected visible pixels are asserted in the
browser test. That test also compares exported on-disk layer record order
against this fixture and leaves its exported PSD in the Playwright output.

To regenerate in a Python environment with `psd-tools` and `Pillow` installed,
run this from the photo-editor directory:

```python
from PIL import Image
from psd_tools import PSDImage
from psd_tools.api.layers import Group, PixelLayer
from psd_tools.constants import BlendMode

psd = PSDImage.new('RGB', (4, 4))
PixelLayer.frompil(Image.new('RGB', (4, 4), (255, 0, 0)), psd,
                   name='Background red')
group = Group.new(psd, 'Group')
group.blend_mode = BlendMode.NORMAL
PixelLayer.frompil(Image.new('RGB', (3, 3), (0, 0, 255)), group,
                   name='Lower blue')
PixelLayer.frompil(Image.new('RGB', (2, 2), (0, 255, 0)), group,
                   name='Upper green', top=1, left=1)
hidden = PixelLayer.frompil(Image.new('RGB', (4, 4), (255, 255, 0)),
                           group, name='Hidden yellow')
hidden.visible = False
psd.save('tests/fixtures/layer-order.psd')
```
