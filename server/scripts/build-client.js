import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
await build({
  entryPoints: [path.join(root, "auth-client-entry.js")],
  outfile: path.join(root, "../pwa/auth-client.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  minify: true,
  sourcemap: false,
  target: ["es2022"],
});
console.log("Built pwa/auth-client.js");
