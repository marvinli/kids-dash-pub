// Builds the page the frame's WebView loads into dist/ (or the desktop preview
// into dist-dev/ with --dev): one script, one stylesheet, local fonts and art.
//
// The shell serves these files from https://frame.kidsdash.local/ (an origin
// that exists only inside the app), so the CSP below can say 'self' and the
// page has no way to reach the network.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes("--dev");
const out = join(here, dev ? "dist-dev" : "dist");
const require = createRequire(import.meta.url);

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  // Per-kid colors are inline style attributes.
  "style-src 'self' 'unsafe-inline'",
  // Kid photos arrive from the shell as verified data: URLs.
  "img-src 'self' data:",
  "font-src 'self'",
].join("; ");

const FONTS = {
  "fredoka-500.woff2": "@fontsource/fredoka/files/fredoka-latin-500-normal.woff2",
  "fredoka-600.woff2": "@fontsource/fredoka/files/fredoka-latin-600-normal.woff2",
  "nunito-700.woff2": "@fontsource/nunito/files/nunito-latin-700-normal.woff2",
  "nunito-800.woff2": "@fontsource/nunito/files/nunito-latin-800-normal.woff2",
};

await rm(out, { recursive: true, force: true });
await mkdir(join(out, "fonts"), { recursive: true });
await mkdir(join(out, "art"), { recursive: true });

await build({
  entryPoints: [join(here, "src", dev ? "dev.ts" : "main.ts")],
  outfile: join(out, "app.js"),
  bundle: true,
  minify: !dev,
  sourcemap: dev,
  format: "iife",
  // The frame's Android System WebView is Chrome 113.
  target: "chrome113",
  legalComments: "none",
});
await copyFile(join(here, "src/styles/app.css"), join(out, "app.css"));
for (const [name, source] of Object.entries(FONTS)) {
  await copyFile(require.resolve(source), join(out, "fonts", name));
}
// The backdrop paintings are most of the art by far (over 30 MB), too much
// for an app update over the frame's Wi-Fi. The app carries only the four
// season originals, enough for a backdrop on any day; the frame downloads
// the rest by hash after installing (`scripts/frame.mjs publish` uploads
// them), listed in art-remote.txt as `<sha256> <name>` lines. The desktop
// preview keeps everything.
const IN_APP_PAINTINGS = new Set(["winter", "spring", "summer", "fall"]);
const painting = (file) => /^bg-(.+?)(-dusk|-night)?(-blur)?\.webp$/.exec(file)?.[1];
const artDir = join(here, "../../assets/art/web");
const remote = [];
for (const file of (await readdir(artDir)).sort()) {
  if (!file.endsWith(".webp")) continue;
  const name = painting(file);
  if (dev || name === undefined || IN_APP_PAINTINGS.has(name)) {
    await copyFile(join(artDir, file), join(out, "art", file));
  } else {
    const sha256 = createHash("sha256")
      .update(await readFile(join(artDir, file)))
      .digest("hex");
    remote.push(`${sha256} ${file}\n`);
  }
}
if (!dev) await writeFile(join(out, "art-remote.txt"), remote.join(""));

await writeFile(
  join(out, "index.html"),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=1920, height=1080, initial-scale=1, user-scalable=no">
<title>Kids dashboard</title>
<link rel="stylesheet" href="app.css">
</head>
<body>
<div id="app"></div>
<script src="app.js"></script>
</body>
</html>
`,
);
console.log(`built ${out}`);
