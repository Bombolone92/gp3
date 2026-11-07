"""Runtime helpers used by the Text Editor and Python Console (not part of the public API)."""

import sys
import json
import traceback
import code
import codeop
import rlcompleter

import bpy
import mathutils

_BANNER_NS = None


def _console_namespace():
    ns = {"__name__": "__console__", "__builtins__": __builtins__, "bpy": bpy, "mathutils": mathutils, "C": bpy.context, "D": bpy.data}
    exec("from mathutils import *\nfrom math import *", ns)
    return ns


_INTERNAL = "/home/pyodide/p3d/"


def _format_tb(exc, skip_first=False):
    """Traceback text without frames from this application's own Python modules."""
    frames = traceback.extract_tb(exc.__traceback__)
    if skip_first:
        frames = frames[1:]
    frames = [f for f in frames if not f.filename.startswith(_INTERNAL)]
    out = []
    if frames:
        out.append("Traceback (most recent call last):\n")
        out.extend(traceback.format_list(frames))
    out.extend(traceback.format_exception_only(type(exc), exc))
    return "".join(out)


class _Console(code.InteractiveConsole):
    def __init__(self):
        super().__init__(locals=_console_namespace(), filename="<console>")

    def write(self, data):
        sys.stderr.write(data)

    def showtraceback(self):
        exc = sys.exc_info()[1]
        sys.last_exc = exc
        sys.stderr.write(_format_tb(exc, skip_first=True))


_console = None


def console():
    global _console
    if _console is None:
        _console = _Console()
    return _console


def console_push(line):
    """Feed one line to the interactive console. Returns 'more' when a block is incomplete."""
    more = console().push(line)
    return "more" if more else "done"


def console_reset_buffer():
    console().resetbuffer()


def complete(text):
    """Completions for the identifier chain at the end of ``text``."""
    import re

    m = re.search(r"[A-Za-z_][\w\.]*$|\.$", text)
    word = m.group(0) if m else ""
    comp = rlcompleter.Completer(console().locals)
    out = []
    i = 0
    while i < 400:
        try:
            r = comp.complete(word, i)
        except Exception:
            r = None
        if r is None:
            break
        if r not in out:
            out.append(r)
        i += 1
    if "." in word:
        out = [c for c in out if not c.rsplit(".", 1)[-1].startswith("_")] or out
    return json.dumps({"word": word, "matches": out})


def run_text(source, name):
    """Execute a text block. Returns JSON: null on success, else {line, error, traceback}."""
    ns = {"__name__": "__main__", "__file__": name, "__builtins__": __builtins__}
    try:
        compiled = compile(source, name, "exec")
    except SyntaxError as e:
        tb = "".join(traceback.format_exception_only(type(e), e))
        return json.dumps({"line": e.lineno or 0, "error": "%s: %s" % (type(e).__name__, e.msg), "traceback": tb})
    try:
        exec(compiled, ns)
    except SystemExit:
        return "null"
    except BaseException as e:
        frames = traceback.extract_tb(e.__traceback__)
        line = 0
        for fr in frames:
            if fr.filename == name:
                line = fr.lineno
        text = _format_tb(e)
        return json.dumps({"line": line, "error": "%s: %s" % (type(e).__name__, e), "traceback": text})
    return "null"
