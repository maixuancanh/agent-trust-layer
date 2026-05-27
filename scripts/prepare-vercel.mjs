import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');

mkdirSync(dist, { recursive: true });
copyFileSync(join(root, 'skills.md'), join(dist, 'skills.md'));
copyFileSync(join(root, 'artifacts', 'agent_trust_layer.idl'), join(dist, 'agent_trust_layer.idl'));

writeFileSync(
  join(dist, 'index.html'),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Agent Trust Layer Artifacts</title>
  </head>
  <body>
    <h1>Agent Trust Layer</h1>
    <ul>
      <li><a href="/skills.md">skills.md</a></li>
      <li><a href="/agent_trust_layer.idl">agent_trust_layer.idl</a></li>
    </ul>
  </body>
</html>
`,
);
