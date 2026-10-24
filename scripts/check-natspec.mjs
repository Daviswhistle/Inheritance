import { readdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(`${directory}/${entry.name}`) : entry.name.endsWith('.sol') ? [`${directory}/${entry.name}`] : []);
}
let checked = 0;
for (const file of files('contracts')) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/^\s*(?:function\s+(\w+)|receive|fallback)\s*\([^;{]*?[;{]/gm)) {
    if (!/\b(public|external)\b/.test(match[0])) continue;
    const preceding = source.slice(0, match.index).trimEnd();
    const documented = /\/\/\/[^\n]*$/.test(preceding) || /\/\*\*[^]*?\*\/$/.test(preceding.slice(preceding.lastIndexOf('/*')));
    assert.ok(documented, `${file}:${source.slice(0, match.index).split('\n').length}: ${match[1] || 'receive/fallback'} needs NatSpec`);
    checked++;
  }
}
console.log(`PASS NatSpec on ${checked} public/external functions and receive handlers`);
