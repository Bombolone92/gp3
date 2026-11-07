from pathlib import Path
import sys,base64,json
from io import BytesIO
from PIL import Image,ImageDraw
import argparse
repo=Path(__file__).resolve().parents[1];sys.path.insert(0,str(repo/'tools'))
parser=argparse.ArgumentParser(description='Original SVG image-mask kernel and source-phase controls')
variants=parser.add_mutually_exclusive_group()
variants.add_argument('--phase',action='store_true');variants.add_argument('--scales',action='store_true');variants.add_argument('--fractional',action='store_true');parser.add_argument('--output-dir',type=Path)
variants.add_argument('--amplitudes',action='store_true',help='Six background levels around an opaque white vertical band')
variants.add_argument('--fractional-impulses',action='store_true',help='One-pixel impulses isolating 1.5:1 kernel weights')
parser.add_argument('--kernel-scale',type=int,default=8,help='Integer source reduction for the six kernel patterns; requires --output-dir when not 8')
args=parser.parse_args()
if args.fractional_impulses and not args.output_dir: parser.error('--fractional-impulses requires --output-dir')
if not 1 <= args.kernel_scale <= 16: parser.error('--kernel-scale must be between 1 and 16')
if args.kernel_scale != 8 and (not args.output_dir or args.phase or args.scales or args.fractional or args.fractional_impulses): parser.error('A custom kernel scale requires --output-dir and no phase or scale-sweep flag')
import canvas_svg_fixture as fixture
out=args.output_dir or repo/'tests/fixtures'/('svg-image-mask-amplitudes' if args.amplitudes else 'svg-image-mask-fractional' if args.fractional else 'svg-image-mask-phase' if args.phase else 'svg-image-mask-scales' if args.scales else 'svg-image-mask-kernel');out.mkdir(parents=True,exist_ok=True)
names=[f'background-{v}' for v in [0,17,83,128,190,254]] if args.amplitudes else [1.25,1.5,2.25,2.5,3.5,4.25] if args.fractional else [1,2,3,4,6,8] if args.scales else [f'phase-{i}' for i in range(6)] if args.phase else ['constant','vertical-band','horizontal-band','square','diagonal','ellipse'];defs=[];shapes=[]
if args.fractional_impulses:
 names=[{'sourceX':x,'background':b} for x,b in [(10,22),(11,128),(12,128),(13,128),(14,26),(15,7)]]
for i,name in enumerate(names):
 background=int(name.split('-')[1]) if args.amplitudes else 128
 im=Image.new('RGB',(round(16*name),round(60*name)) if args.scales or args.fractional else (16*args.kernel_scale,60*args.kernel_scale),(background,)*3);draw=ImageDraw.Draw(im)
 midx,midy=im.width//2,im.height//2
 if name=='vertical-band' or args.amplitudes:draw.rectangle((midx,0,midx+args.kernel_scale-1,im.height-1),fill='white')
 elif name=='horizontal-band':draw.rectangle((0,midy,im.width-1,midy+args.kernel_scale-1),fill='white')
 elif name=='square':draw.rectangle((midx,midy,midx+args.kernel_scale-1,midy+args.kernel_scale-1),fill='white')
 elif name=='diagonal':draw.line((0,0,im.width-1,im.height-1),fill='white',width=args.kernel_scale)
 elif name=='ellipse':draw.ellipse((0,0,im.width-1,im.height-1),fill='white')
 if args.phase:draw.rectangle((64+i,0,64+i,479),fill='white')
 if args.scales or args.fractional:draw.ellipse((0,0,im.width-1,im.height-1),fill='white')
 if args.fractional_impulses:
  im=Image.new('RGB',(24,90),(name['background'],)*3)
  ImageDraw.Draw(im).line((name['sourceX'],0,name['sourceX'],89),fill='white')
 im.save(out/f'source-{i}.png');data=BytesIO();im.save(data,format='PNG');uri='data:image/png;base64,'+base64.b64encode(data.getvalue()).decode();x=2+20*i
 defs.append(f'<mask id="m{i}" maskUnits="userSpaceOnUse" x="{x}" y="10" width="16" height="60"><image x="{x}" y="10" width="16" height="60" href="{uri}"/></mask>')
 shapes.append(f'<rect x="{x}" y="10" width="16" height="60" fill="#2060C0" mask="url(#m{i})"/>')
fixture.SOURCE=out/'control.docx';fixture.SVG=('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><defs>'+''.join(defs)+'</defs>'+''.join(shapes)+'</svg>').encode();fixture.generate();(out/'cases.json').write_text(json.dumps(names))
