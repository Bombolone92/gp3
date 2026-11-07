/**
 * Bundled font files (latin subset, WOFF) from @fontsource packages. Each
 * import is only a URL: nothing is downloaded until a face is needed, then
 * fonts.js fetches it once and uses the same bytes for display (FontFace)
 * and for Create Outlines (opentype.js). Generated from the installed
 * packages; licenses are OFL-1.1 except Permanent Marker (Apache-2.0).
 */
import f1 from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
import f2 from '@fontsource/inter/files/inter-latin-400-italic.woff?url';
import f3 from '@fontsource/inter/files/inter-latin-700-normal.woff?url';
import f4 from '@fontsource/inter/files/inter-latin-700-italic.woff?url';
import f5 from '@fontsource/roboto/files/roboto-latin-400-normal.woff?url';
import f6 from '@fontsource/roboto/files/roboto-latin-400-italic.woff?url';
import f7 from '@fontsource/roboto/files/roboto-latin-700-normal.woff?url';
import f8 from '@fontsource/roboto/files/roboto-latin-700-italic.woff?url';
import f9 from '@fontsource/open-sans/files/open-sans-latin-400-normal.woff?url';
import f10 from '@fontsource/open-sans/files/open-sans-latin-400-italic.woff?url';
import f11 from '@fontsource/open-sans/files/open-sans-latin-700-normal.woff?url';
import f12 from '@fontsource/open-sans/files/open-sans-latin-700-italic.woff?url';
import f13 from '@fontsource/lato/files/lato-latin-400-normal.woff?url';
import f14 from '@fontsource/lato/files/lato-latin-400-italic.woff?url';
import f15 from '@fontsource/lato/files/lato-latin-700-normal.woff?url';
import f16 from '@fontsource/lato/files/lato-latin-700-italic.woff?url';
import f17 from '@fontsource/montserrat/files/montserrat-latin-400-normal.woff?url';
import f18 from '@fontsource/montserrat/files/montserrat-latin-400-italic.woff?url';
import f19 from '@fontsource/montserrat/files/montserrat-latin-700-normal.woff?url';
import f20 from '@fontsource/montserrat/files/montserrat-latin-700-italic.woff?url';
import f21 from '@fontsource/poppins/files/poppins-latin-400-normal.woff?url';
import f22 from '@fontsource/poppins/files/poppins-latin-400-italic.woff?url';
import f23 from '@fontsource/poppins/files/poppins-latin-700-normal.woff?url';
import f24 from '@fontsource/poppins/files/poppins-latin-700-italic.woff?url';
import f25 from '@fontsource/oswald/files/oswald-latin-400-normal.woff?url';
import f26 from '@fontsource/oswald/files/oswald-latin-700-normal.woff?url';
import f27 from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff?url';
import f28 from '@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff?url';
import f29 from '@fontsource/source-serif-4/files/source-serif-4-latin-400-italic.woff?url';
import f30 from '@fontsource/source-serif-4/files/source-serif-4-latin-700-normal.woff?url';
import f31 from '@fontsource/source-serif-4/files/source-serif-4-latin-700-italic.woff?url';
import f32 from '@fontsource/merriweather/files/merriweather-latin-400-normal.woff?url';
import f33 from '@fontsource/merriweather/files/merriweather-latin-400-italic.woff?url';
import f34 from '@fontsource/merriweather/files/merriweather-latin-700-normal.woff?url';
import f35 from '@fontsource/merriweather/files/merriweather-latin-700-italic.woff?url';
import f36 from '@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff?url';
import f37 from '@fontsource/playfair-display/files/playfair-display-latin-400-italic.woff?url';
import f38 from '@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff?url';
import f39 from '@fontsource/playfair-display/files/playfair-display-latin-700-italic.woff?url';
import f40 from '@fontsource/lora/files/lora-latin-400-normal.woff?url';
import f41 from '@fontsource/lora/files/lora-latin-400-italic.woff?url';
import f42 from '@fontsource/lora/files/lora-latin-700-normal.woff?url';
import f43 from '@fontsource/lora/files/lora-latin-700-italic.woff?url';
import f44 from '@fontsource/roboto-mono/files/roboto-mono-latin-400-normal.woff?url';
import f45 from '@fontsource/roboto-mono/files/roboto-mono-latin-400-italic.woff?url';
import f46 from '@fontsource/roboto-mono/files/roboto-mono-latin-700-normal.woff?url';
import f47 from '@fontsource/roboto-mono/files/roboto-mono-latin-700-italic.woff?url';
import f48 from '@fontsource/source-code-pro/files/source-code-pro-latin-400-normal.woff?url';
import f49 from '@fontsource/source-code-pro/files/source-code-pro-latin-400-italic.woff?url';
import f50 from '@fontsource/source-code-pro/files/source-code-pro-latin-700-normal.woff?url';
import f51 from '@fontsource/source-code-pro/files/source-code-pro-latin-700-italic.woff?url';
import f52 from '@fontsource/pacifico/files/pacifico-latin-400-normal.woff?url';
import f53 from '@fontsource/lobster/files/lobster-latin-400-normal.woff?url';
import f54 from '@fontsource/dancing-script/files/dancing-script-latin-400-normal.woff?url';
import f55 from '@fontsource/dancing-script/files/dancing-script-latin-700-normal.woff?url';
import f56 from '@fontsource/permanent-marker/files/permanent-marker-latin-400-normal.woff?url';

export const BUNDLED_FONTS = [
  { family: 'Inter', category: 'sans-serif', faces: [{ weight: 400, style: 'normal', url: f1 }, { weight: 400, style: 'italic', url: f2 }, { weight: 700, style: 'normal', url: f3 }, { weight: 700, style: 'italic', url: f4 }] },
  { family: 'Roboto', category: 'sans-serif', faces: [{ weight: 400, style: 'normal', url: f5 }, { weight: 400, style: 'italic', url: f6 }, { weight: 700, style: 'normal', url: f7 }, { weight: 700, style: 'italic', url: f8 }] },
  { family: 'Open Sans', category: 'sans-serif', faces: [{ weight: 400, style: 'normal', url: f9 }, { weight: 400, style: 'italic', url: f10 }, { weight: 700, style: 'normal', url: f11 }, { weight: 700, style: 'italic', url: f12 }] },
  { family: 'Lato', category: 'sans-serif', faces: [{ weight: 400, style: 'normal', url: f13 }, { weight: 400, style: 'italic', url: f14 }, { weight: 700, style: 'normal', url: f15 }, { weight: 700, style: 'italic', url: f16 }] },
  { family: 'Montserrat', category: 'sans-serif', faces: [{ weight: 400, style: 'normal', url: f17 }, { weight: 400, style: 'italic', url: f18 }, { weight: 700, style: 'normal', url: f19 }, { weight: 700, style: 'italic', url: f20 }] },
  { family: 'Poppins', category: 'sans-serif', faces: [{ weight: 400, style: 'normal', url: f21 }, { weight: 400, style: 'italic', url: f22 }, { weight: 700, style: 'normal', url: f23 }, { weight: 700, style: 'italic', url: f24 }] },
  { family: 'Oswald', category: 'sans-serif', faces: [{ weight: 400, style: 'normal', url: f25 }, { weight: 700, style: 'normal', url: f26 }] },
  { family: 'Bebas Neue', category: 'display', faces: [{ weight: 400, style: 'normal', url: f27 }] },
  { family: 'Source Serif 4', category: 'serif', faces: [{ weight: 400, style: 'normal', url: f28 }, { weight: 400, style: 'italic', url: f29 }, { weight: 700, style: 'normal', url: f30 }, { weight: 700, style: 'italic', url: f31 }] },
  { family: 'Merriweather', category: 'serif', faces: [{ weight: 400, style: 'normal', url: f32 }, { weight: 400, style: 'italic', url: f33 }, { weight: 700, style: 'normal', url: f34 }, { weight: 700, style: 'italic', url: f35 }] },
  { family: 'Playfair Display', category: 'serif', faces: [{ weight: 400, style: 'normal', url: f36 }, { weight: 400, style: 'italic', url: f37 }, { weight: 700, style: 'normal', url: f38 }, { weight: 700, style: 'italic', url: f39 }] },
  { family: 'Lora', category: 'serif', faces: [{ weight: 400, style: 'normal', url: f40 }, { weight: 400, style: 'italic', url: f41 }, { weight: 700, style: 'normal', url: f42 }, { weight: 700, style: 'italic', url: f43 }] },
  { family: 'Roboto Mono', category: 'monospace', faces: [{ weight: 400, style: 'normal', url: f44 }, { weight: 400, style: 'italic', url: f45 }, { weight: 700, style: 'normal', url: f46 }, { weight: 700, style: 'italic', url: f47 }] },
  { family: 'Source Code Pro', category: 'monospace', faces: [{ weight: 400, style: 'normal', url: f48 }, { weight: 400, style: 'italic', url: f49 }, { weight: 700, style: 'normal', url: f50 }, { weight: 700, style: 'italic', url: f51 }] },
  { family: 'Pacifico', category: 'handwriting', faces: [{ weight: 400, style: 'normal', url: f52 }] },
  { family: 'Lobster', category: 'display', faces: [{ weight: 400, style: 'normal', url: f53 }] },
  { family: 'Dancing Script', category: 'handwriting', faces: [{ weight: 400, style: 'normal', url: f54 }, { weight: 700, style: 'normal', url: f55 }] },
  { family: 'Permanent Marker', category: 'handwriting', faces: [{ weight: 400, style: 'normal', url: f56 }] },
];
