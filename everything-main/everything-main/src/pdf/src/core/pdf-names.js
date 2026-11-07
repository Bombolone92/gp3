import { PDFName } from 'pdf-lib';

// A name's #xx escapes may use either case (ISO 32000-1, 7.3.5), but pdf-lib decodes only
// uppercase ones. A lowercase escape such as /F#2fa stayed literal and was saved as /F#232fa,
// so content that named the resource found nothing. Uppercase the escapes before it decodes.
const of = PDFName.of;
if (!of.anyCaseEscapes) {
  const anyCase = (name) =>
    of(
      typeof name === 'string'
        ? name.replace(/#([\da-f]{2})/gi, (_, hex) => `#${hex.toUpperCase()}`)
        : name,
    );
  anyCase.anyCaseEscapes = true;
  PDFName.of = anyCase;
}
