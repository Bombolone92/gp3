#!/usr/bin/env python3
"""Regenerates the codec interop fixtures in this folder.

Every image is a synthetic pattern computed below (no third-party pictures).
Files are written by independent encoders (ImageMagick 7 and Pillow/libtiff)
so the TypeScript decoders are checked against other implementations.
Where the result is lossy or palettized, ImageMagick's own decode is stored
next to it as raw RGBA (*.rgba) for comparison.

Usage: python3 -I generate.py   (needs `magick` and Pillow on PATH)
"""
import os
import struct
import subprocess
import sys
import tempfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 23, 17


def px(x, y):
    # Must match `pattern()` in tests/codecs-interop.test.ts.
    r = (x * 16 + y * 3) & 255
    g = (x * y * 5 + 40) & 255
    b = ((x ^ y) * 9) & 255
    a = max(0, 255 - x * 7 - y * 3)
    return r, g, b, a


def lo(x, y):
    return (x * 13 + y * 7) & 255


def rgba8():
    return bytes(v for y in range(H) for x in range(W) for v in px(x, y))


def rgb16_be():
    out = bytearray()
    for y in range(H):
        for x in range(W):
            for v in px(x, y)[:3]:
                out += struct.pack('>H', (v << 8) | lo(x, y))
    return bytes(out)


def gray_f32_le():
    return b''.join(struct.pack('<f', px(x, y)[0] / 255) for y in range(H) for x in range(W))


def magick(*args):
    subprocess.run(['magick', *args], check=True)


def out(name):
    return os.path.join(HERE, name)


def main():
    tmp = tempfile.mkdtemp()
    src_rgba = os.path.join(tmp, 'src.rgba')
    with open(src_rgba, 'wb') as f:
        f.write(rgba8())
    src16 = os.path.join(tmp, 'src16.rgb')
    with open(src16, 'wb') as f:
        f.write(rgb16_be())
    srcf = os.path.join(tmp, 'srcf.gray')
    with open(srcf, 'wb') as f:
        f.write(gray_f32_le())
    size = f'{W}x{H}'
    rgba_in = ['-size', size, '-depth', '8', f'rgba:{src_rgba}']
    rgb_in = ['-size', size, '-depth', '8', f'rgba:{src_rgba}', '-alpha', 'off']

    # TIFF
    magick('-size', size, '-depth', '16', '-endian', 'MSB', f'rgb:{src16}', '-compress', 'LZW', '-define', 'tiff:predictor=2', '-endian', 'MSB', out('im-rgb16-be-lzw-pred.tif'))
    magick(*rgba_in, '-compress', 'Zip', '-define', 'tiff:tile-geometry=16x16', '-interlace', 'plane', '-define', 'tiff:alpha=unassociated', out('im-rgba-tiled-planar-zip.tif'))
    magick('-size', size, '-depth', '32', '-endian', 'LSB', '-define', 'quantum:format=floating-point', f'gray:{srcf}', '-compress', 'LZW', '-define', 'tiff:predictor=3', '-define', 'quantum:format=floating-point', '-depth', '32', out('im-gray-float-pred3.tif'))
    magick(*rgb_in, '-compress', 'LZW', 'TIFF64:' + out('im-bigtiff.tif'))
    img = Image.frombytes('RGBA', (W, H), rgba8())
    img.convert('CMYK').save(out('pil-cmyk-packbits.tif'), compression='packbits')
    img.convert('RGB').quantize(16).save(out('pil-palette-lzw.tif'), compression='tiff_lzw')
    img.convert('L').point(lambda v: 255 if v > 100 else 0).convert('1').save(out('pil-bilevel.tif'), compression='packbits')
    for name in ('pil-palette-lzw.tif', 'pil-bilevel.tif'):
        magick(out(name), '-depth', '8', 'rgba:' + out(name + '.rgba'))
    rgb = img.convert('RGB')
    rgb.save(out('pil-multipage.tif'), save_all=True, append_images=[img.convert('L')], compression='tiff_adobe_deflate')

    # GIF: three frames with transparency, disposal and delays, plus IM's coalesced frames.
    frames = []
    for k in range(3):
        f = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        for y in range(H):
            for x in range(W):
                if (x // 4 + k) % 3 == 0 or y == k * 5:
                    r, g, b, _ = px(x, y)
                    f.putpixel((x, y), (r & 0xF0, g & 0xF0, b & 0xC0, 255))
        p = os.path.join(tmp, f'f{k}.png')
        f.save(p)
        frames.append(p)
    magick('-delay', '7', '-dispose', 'Background', frames[0], '-delay', '12', '-dispose', 'Previous', frames[1], '-delay', '20', '-dispose', 'None', frames[2], '-loop', '2', out('im-anim.gif'))
    magick(out('im-anim.gif'), '-coalesce', '-depth', '8', 'rgba:' + out('im-anim.coalesced.rgba'))
    img.convert('RGB').quantize(64).save(out('pil-interlaced.gif'), interlace=True)
    magick(out('pil-interlaced.gif'), '-depth', '8', 'rgba:' + out('pil-interlaced.gif.rgba'))

    # BMP
    magick(*rgb_in, '-colors', '16', '-compress', 'RLE', 'BMP3:' + out('im-rle8.bmp'))
    magick(out('im-rle8.bmp'), '-depth', '8', 'rgba:' + out('im-rle8.bmp.rgba'))
    magick(*rgb_in, '-define', 'bmp:subtype=RGB565', out('im-rgb565.bmp'))
    magick(out('im-rgb565.bmp'), '-depth', '8', 'rgba:' + out('im-rgb565.bmp.rgba'))
    magick(*rgba_in, 'BMP:' + out('im-v5-alpha.bmp'))
    img.convert('1').save(out('pil-1bit.bmp'))
    magick(out('pil-1bit.bmp'), '-depth', '8', 'rgba:' + out('pil-1bit.bmp.rgba'))

    # ICO: ImageMagick (BMP entries) and Pillow (PNG entries).
    sq = os.path.join(tmp, 'sq.png')
    magick(*rgba_in, '-resize', '32x32!', sq)
    magick(sq, '-define', 'icon:auto-resize=32,16', out('im-multi.ico'))
    magick(out('im-multi.ico') + '[0]', '-depth', '8', 'rgba:' + out('im-multi.ico.0.rgba'))
    Image.open(sq).save(out('pil-png.ico'), sizes=[(16, 16), (32, 32)])

    # TGA
    magick(*rgba_in, '-compress', 'RLE', out('im-rle.tga'))
    img.save(out('pil-rle.tga'), compression='tga_rle')
    img.convert('RGB').save(out('pil-raw24.tga'))

    # Netpbm
    magick('-size', size, '-depth', '16', '-endian', 'MSB', f'rgb:{src16}', out('im-rgb16.ppm'))
    magick(*rgb_in, '-colorspace', 'gray', '-compress', 'none', out('im-plain.pgm'))
    magick(out('im-plain.pgm'), '-depth', '8', 'rgba:' + out('im-plain.pgm.rgba'))
    magick(*rgba_in, out('im-rgba.pam'))

    # JPEG with EXIF orientation and an ICC profile (bytes are a dummy profile).
    exif = Image.Exif()
    exif[0x0112] = 6
    rgb.save(out('pil-exif-icc.jpg'), exif=exif.tobytes(), icc_profile=bytes(range(256)) * 3, quality=90)
    print('ok', file=sys.stderr)


if __name__ == '__main__':
    main()
