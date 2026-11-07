// Loads pdf.js only when someone imports a PDF, so the viewer code and its
// worker stay out of the main bundle. The legacy build supports the widest
// range of browsers. No fonts or character maps are fetched from elsewhere:
// PDFs that rely on non-embedded fonts render with local substitutes. The
// image decoders for scanned pages (JBIG2, CCITT, JPEG 2000) come from the
// application's own host, where vite.config.js places them.
let loading = null;
export function loadPdfjs() {
  loading ||= Promise.all([
    import("pdfjs-dist/legacy/build/pdf.min.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ])
    .then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const wasmUrl = new URL(
        `${import.meta.env.BASE_URL}assets/pdfjs-${pdfjs.version}/`,
        location.href,
      ).href;
      return {
        ...pdfjs,
        getDocument: (source) => pdfjs.getDocument({ ...source, wasmUrl }),
      };
    })
    .catch((error) => {
      loading = null;
      throw Error(
        "Could not load the PDF reader. Check your connection and try again.",
        { cause: error },
      );
    });
  return loading;
}
