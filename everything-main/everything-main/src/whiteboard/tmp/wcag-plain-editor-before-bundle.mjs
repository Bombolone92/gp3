import { build } from "vite";
import { readFileSync } from "node:fs";
const snapshots = new Map(["main", "features", "rich-text", "content/content"].map(name => [new URL("../src/" + name + ".js", import.meta.url).pathname, readFileSync("/tmp/whiteboard-before-plain-editor-ranges-" + name.split("/").at(-1) + ".js", "utf8")]));
export async function appBundle() {
 const bundle = await build({ configFile:false,logLevel:"silent",plugins:[{name:"verified-before-source",load(id){return snapshots.get(id) ?? null;}}],build:{write:false,rollupOptions:{output:{manualChunks:id=>/pdfjs-dist/.test(id)?undefined:"index"}}}});
 return bundle.output.find(file=>file.type==="chunk"&&file.isEntry).code;
}
