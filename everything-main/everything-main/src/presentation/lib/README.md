# Presentation engine

This code is owned and maintained in this repository. Edit the TypeScript
source directly. There is no upstream synchronization, submodule, package
update process, or generated bundle to patch.

- `pptx/src`: the complete PPTX reader, editor, writer, and Node file helpers.
- `pptx-preview/src`: the browser-safe SVG renderer and text layout audit.
- `pptx/src/**/*.test.ts`: XML, OPC, and PresentationML unit tests, run by
  `npm test` alongside the application's regression tests.

Vite builds these sources into the app. Node 22.18 or later can also import
them directly. Run `npm run typecheck` to check the library's TypeScript.

The starting code came from these MIT-licensed OfficeKit releases:

| Source  | Original version | Original revision                          |
| ------- | ---------------- | ------------------------------------------ |
| PPTX    | 0.12.0           | `1d7d577482f2facf7e079e11d062ba8ab7cc02ec` |
| Preview | 0.9.1            | `51b1f90b91ef9ea30b49bc38e5500c8acc344412` |

Original repository: <https://github.com/office-kit/pptx>. These revisions
record provenance only. The MIT license and copyright notices are retained
in each library directory and in the app's third-party notices.

All existing application patches are incorporated into this source: archive
path handling and trash entries, copied group IDs, hidden groups and shapes,
empty-placeholder formatting, preset geometry, authored font resolution,
and the slide-layout read cache. Internal symbol keys retain their original
names for compatibility.

The upstream website, publishing automation, compiled packages, and optional
fontkit/resvg adapter with its font assets are outside this copy. The app
uses browser font measurement and its existing SVG-to-image export path.
