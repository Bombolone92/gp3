"""Windows native diagnostic, not renderer code. Scale an authored RGB PNG with WIC Fant."""
import ctypes as C
import uuid
from pathlib import Path
from PIL import Image

P = C.c_void_p
U = C.c_uint32

def _guid(value):
    return (C.c_ubyte * 16).from_buffer_copy(uuid.UUID(value).bytes_le)

def _call(obj, index, types, *args):
    table = C.cast(obj, C.POINTER(C.POINTER(P))).contents
    result = C.WINFUNCTYPE(C.c_long, P, *types)(table[index])(obj, *args)
    if result < 0:
        raise OSError(hex(result & 0xffffffff))

def scale_rgb(source, width, height):
    """Return native RGB pixels; deliberately decline other decoded pixel formats."""
    initialized = C.windll.ole32.CoInitialize(None)
    if initialized < 0:
        raise OSError(hex(initialized & 0xffffffff))
    factory, decoder, frame, scaler = P(), P(), P(), P()
    try:
        result = C.windll.ole32.CoCreateInstance(
            _guid('cacaf262-9370-4615-a13b-9f5539da4c0a'), None, 1,
            _guid('ec5ec8a9-c395-4314-9c77-54d7a935ff70'), C.byref(factory))
        if result < 0:
            raise OSError(hex(result & 0xffffffff))
        _call(factory, 3, [C.c_wchar_p, P, U, U, C.POINTER(P)], str(Path(source).resolve()), None, 0x80000000, 0, C.byref(decoder))
        _call(decoder, 13, [U, C.POINTER(P)], 0, C.byref(frame))
        pixel_format = (C.c_ubyte * 16)()
        _call(frame, 4, [P], pixel_format)
        if str(uuid.UUID(bytes_le=bytes(pixel_format))) != '6fddc324-4e03-4bfe-b185-3d77768dc90c':
            raise ValueError('This native reference requires an authored 24bpp BGR source')
        _call(factory, 11, [C.POINTER(P)], C.byref(scaler))
        _call(scaler, 8, [P, U, U, U], frame, width, height, 3)
        stride = width * 3
        pixels = (C.c_ubyte * (stride * height))()
        _call(scaler, 7, [P, U, U, P], None, stride, len(pixels), pixels)
        return Image.frombytes('RGB', (width, height), bytes(pixels), 'raw', 'BGR')
    finally:
        for obj in [scaler, frame, decoder, factory]:
            if obj:
                _call(obj, 2, [])
        C.windll.ole32.CoUninitialize()


def scale_float_rgb(rgb, width, height):
    """Expose native pre-quantization RGB using opaque 128bpp float input.

    Diagnostic values stay in byte units (0..255), with alpha 1. WIC returns
    PRGBAFloat, not the input RGBAFloat format. This does not model transparent
    input or certify that another native pixel format shares the same path.
    API declarations: Microsoft's WinSDK wincodec.h, IWICImagingFactory's
    CreateBitmapFromMemory and GUID_WICPixelFormat128bppRGBAFloat.
    """
    import numpy as np

    rgb = np.asarray(rgb)
    if rgb.ndim != 3 or rgb.shape[2] != 3 or min(rgb.shape[:2]) < 1 or min(width, height) < 1:
        raise ValueError('Expected nonempty RGB input and positive output dimensions')
    source = np.concatenate([rgb.astype(np.float32), np.ones((*rgb.shape[:2], 1), dtype=np.float32)], axis=2)
    data = (C.c_ubyte * source.nbytes).from_buffer_copy(source.tobytes())
    initialized = C.windll.ole32.CoInitialize(None)
    if initialized < 0:
        raise OSError(hex(initialized & 0xffffffff))
    factory, bitmap, scaler = P(), P(), P()
    try:
        result = C.windll.ole32.CoCreateInstance(
            _guid('cacaf262-9370-4615-a13b-9f5539da4c0a'), None, 1,
            _guid('ec5ec8a9-c395-4314-9c77-54d7a935ff70'), C.byref(factory))
        if result < 0:
            raise OSError(hex(result & 0xffffffff))
        _call(factory, 20, [U, U, P, U, U, P, C.POINTER(P)], source.shape[1], source.shape[0],
              _guid('6fddc324-4e03-4bfe-b185-3d77768dc919'), source.shape[1] * 16,
              source.nbytes, data, C.byref(bitmap))
        _call(factory, 11, [C.POINTER(P)], C.byref(scaler))
        _call(scaler, 8, [P, U, U, U], bitmap, width, height, 3)
        pixel_format = (C.c_ubyte * 16)()
        _call(scaler, 4, [P], pixel_format)
        if str(uuid.UUID(bytes_le=bytes(pixel_format))) != '6fddc324-4e03-4bfe-b185-3d77768dc91a':
            raise ValueError('Unexpected native float output format; expected 128bpp PRGBAFloat')
        pixels = (C.c_float * (width * height * 4))()
        _call(scaler, 7, [P, U, U, P], None, width * 16, width * height * 16, pixels)
        return np.ctypeslib.as_array(pixels).reshape(height, width, 4)[:, :, :3].copy()
    finally:
        for obj in [scaler, bitmap, factory]:
            if obj:
                _call(obj, 2, [])
        C.windll.ole32.CoUninitialize()
