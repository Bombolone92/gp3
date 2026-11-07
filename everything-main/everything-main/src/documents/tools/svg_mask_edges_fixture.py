"""Original curved/fractional mask edges for native raster sampling evidence."""
import canvas_svg_fixture as fixture
fixture.SOURCE=fixture.SOURCE.with_name('svg-mask-edges.docx')
defs='''<mask id="white" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="80"><rect width="120" height="80" fill="white"/></mask>
<mask id="gray" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="80"><rect width="120" height="80" fill="#808080"/></mask>
<mask id="curve" maskContentUnits="objectBoundingBox" x="0" y="0" width="1" height="1"><ellipse cx=".5" cy=".5" rx=".5" ry=".5" fill="white"/></mask>'''
panels=[]
for i in range(6):
    # Two identical curves at integer/fractional origins, grayscale alpha, curved
    # mask content, and a transformed target. Each panel has a separate mask layer.
    x=i*20+2+(0.25 if i==1 else 0)
    d=f'M{x} 10 C{x+18} 10 {x+18} 70 {x} 70 Z'
    mask='gray' if i==2 else 'curve' if i in [3,4] else 'white'
    if i==4:
        panels.append(f'<rect x="{x}" y="10" width="16" height="60" fill="#2060C0" mask="url(#{mask})"/>')
    else:
        transform=f' transform="rotate(5,{x+8},40)"' if i==5 else ''
        panels.append(f'<path d="{d}" fill="#2060C0" mask="url(#{mask})"{transform}/>')
fixture.SVG=('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><defs>'+defs+'</defs>'+''.join(panels)+'</svg>').encode()
fixture.generate()
