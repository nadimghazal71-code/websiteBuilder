// Assembles design/<Name>.dc.html from design/parts/<Name>.body.html + design/parts/base.css.
// The .dc.html files are the working files the canvas is seeded from; parts/ is the source
// so the shared wireframe kit lives in exactly one place.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const parts = join(here, 'parts');
const css = readFileSync(join(parts, 'base.css'), 'utf8').trimEnd();
const fonts = 'https://fonts.googleapis.com/css2?family=Architects+Daughter&family=Noto+Kufi+Arabic:wght@400;700&family=Space+Mono:wght@400;700&display=swap';

const bodies = readdirSync(parts).filter((f) => f.endsWith('.body.html')).sort();
if (!bodies.length) throw new Error('no .body.html files in design/parts');

for (const file of bodies) {
  const name = file.replace(/\.body\.html$/, '');
  const body = readFileSync(join(parts, file), 'utf8').trimEnd();
  const out = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="${fonts}">
  <style>
${css}
  </style>
</helmet>
${body}
</x-dc>
</body>
</html>
`;
  writeFileSync(join(here, `${name}.dc.html`), out);
  console.log(`built ${name}.dc.html  ${out.length} bytes`);
}
