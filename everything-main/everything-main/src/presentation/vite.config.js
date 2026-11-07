import { defineConfig } from "vite";
import puterLocalhost from "../../dev/puter-localhost.mjs";
export default defineConfig({
  plugins: [puterLocalhost("presentation")],
  base: "./",
  test: { include: ["tests/**/*.test.js", "lib/**/*.test.ts"] },
});
