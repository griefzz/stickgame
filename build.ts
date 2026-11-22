// Builds dist/index.html (one self-contained file: JS, CSS and fonts inlined)
// and dist/server.js (the Bun game server).
import { mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = import.meta.dir;
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });

const PLACEHOLDER = "__OC_BUILD_ID__";
const client = await Bun.build({
  entrypoints: [join(root, "src/client/main.ts")],
  target: "browser",
  format: "esm",
  minify: true,
  define: { __BUILD__: JSON.stringify(PLACEHOLDER) },
});
if (!client.success) {
  for (const l of client.logs) console.error(l);
  process.exit(1);
}
let js = (await client.outputs[0].text()).replace(/<\/script/gi, "<\\/script");

const font = (file: string, family: string, weight: string) => {
  const b64 = readFileSync(join(root, "assets/fonts", file)).toString("base64");
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
};
const fonts = [
  font("bigshoulders-latin.woff2", "Big Shoulders Display", "700 900"),
  font("chakra-500.woff2", "Chakra Petch", "500"),
  font("chakra-600.woff2", "Chakra Petch", "600"),
  font("chakra-700.woff2", "Chakra Petch", "700"),
].join("");

const css = readFileSync(join(root, "src/client/style.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s*\n\s*/g, "")
  .replace(/\s{2,}/g, " ");

let html = readFileSync(join(root, "src/client/index.html"), "utf8")
  .replace("/*__CSS__*/", () => fonts + css)
  .replace("/*__JS__*/", () => js);
// Build ID = hash of the page itself, so it changes exactly when the client changes.
// The server reads it from the <meta name="build"> tag and idle players reload into new builds.
const buildId = new Bun.CryptoHasher("sha256").update(html).digest("hex").slice(0, 12);
html = html.split(PLACEHOLDER).join(buildId);
writeFileSync(join(dist, "index.html"), html);

const server = await Bun.build({
  entrypoints: [join(root, "src/server/main.ts")],
  target: "bun",
  format: "esm",
  minify: false,
});
if (!server.success) {
  for (const l of server.logs) console.error(l);
  process.exit(1);
}
writeFileSync(join(dist, "server.js"), await server.outputs[0].text());

const kb = (p: string) => (statSync(p).size / 1024).toFixed(0) + " KB";
console.log(`dist/index.html  ${kb(join(dist, "index.html"))}  build ${buildId}`);
console.log(`dist/server.js   ${kb(join(dist, "server.js"))}`);
