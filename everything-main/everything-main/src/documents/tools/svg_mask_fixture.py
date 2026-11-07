"""Independently authored SVG mask, embedded raster and color-matrix controls."""
from base64 import b64encode
from io import BytesIO
from PIL import Image
import canvas_svg_fixture as fixture

fixture.SOURCE=fixture.SOURCE.with_name('svg-masks.docx')
def raster(format):
    image=Image.new('RGB',(20,80),'white')
    for y in range(40,80):
        for x in range(20):image.putpixel((x,y),(0,0,0))
    stream=BytesIO();image.save(stream,format=format)
    return b64encode(stream.getvalue()).decode()

defs='''<mask id="half" maskUnits="userSpaceOnUse" x="0" y="0" width="20" height="80">
<rect width="20" height="40" fill="white"/></mask>
<mask id="gray" maskUnits="userSpaceOnUse" x="20" y="0" width="20" height="80">
<rect x="20" width="20" height="80" fill="#808080"/></mask>
<mask id="alpha" maskUnits="userSpaceOnUse" x="40" y="0" width="20" height="80">
<rect x="40" width="20" height="80" fill="white" opacity="0.5"/></mask>
<mask id="box" maskContentUnits="objectBoundingBox" x="0" y="0" width="1" height="1">
<rect width="1" height="0.5" fill="white"/></mask>
<filter id="invert" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse"
x="100" y="0" width="20" height="80"><feColorMatrix type="matrix"
color-interpolation-filters="sRGB" values="-1 0 0 0 1 0 -1 0 0 1 0 0 -1 0 1 0 0 0 1 0"/></filter>'''
defs+=f'''<mask id="png" maskUnits="userSpaceOnUse" x="80" y="0" width="20" height="80">
<image x="80" width="20" height="80" xlink:href="data:image/png;base64,{raster('PNG')}"/></mask>
<mask id="jpeg" maskUnits="userSpaceOnUse" x="100" y="0" width="20" height="80">
<g filter="url(#invert)"><image x="100" width="20" height="80"
xlink:href="data:image/jpeg;base64,{raster('JPEG')}"/></g></mask>'''
panels=''.join(f'<rect x="{i*20}" width="20" height="80" fill="#2060C0" mask="url(#{name})"/>'
    for i,name in enumerate(['half','gray','alpha','box','png','jpeg']))
fixture.SVG=('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
    'width="120" height="80" viewBox="0 0 120 80"><defs>'+defs+'</defs>'+panels+'</svg>').encode()
fixture.generate()
