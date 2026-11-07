import { build } from "vite";

// The app as a single script for tests that run it in a DOM. Features that
// load on demand in production are kept in it, since the script is evaluated
// without a server to fetch them from; only the PDF reader stays separate.
export async function appBundle() {
  const bundle = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      rollupOptions: {
        output: {
          manualChunks: (id) => (/pdfjs-dist/.test(id) ? undefined : "index"),
        },
      },
    },
  });
  return bundle.output.find((file) => file.type === "chunk" && file.isEntry)
    .code;
}
