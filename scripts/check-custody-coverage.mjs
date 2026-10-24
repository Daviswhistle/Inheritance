import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// Deliberately include shared custody helpers. Undeployed multi-token prototypes,
// operator-only gas funding, scripts and mocks are not customer custody targets.
const primary = [
  'InheritanceVaultWLD', 'InheritanceVaultWLDFactoryOnePerOwner',
  'InheritanceVaultMorpho', 'InheritanceVaultMorphoFactory', 'InheritanceVaultMorphoDeployer',
  'InheritanceVaultUSDC', 'InheritanceVaultUSDCFactory', 'InheritanceVaultUSDCDeployer',
].map(name => `contracts/${name}.sol`);
const helpers = ['SafeERC20Lib', 'YieldMath', 'ImmutableCreationCode'].map(name => `contracts/libraries/${name}.sol`);
const report = readFileSync(process.argv[2] || 'coverage-summary.txt', 'utf8');
let covered = 0, total = 0;
for (const path of [...primary, ...helpers]) {
  const row = report.split('\n').find(line => line.split('|')[1]?.trim() === path);
  const match = row?.split('|')[2]?.match(/\((\d+)\/(\d+)\)/);
  assert.ok(match, `Missing line coverage for ${path}`);
  const hit = Number(match[1]), count = Number(match[2]);
  assert.ok(count > 0 && hit <= count, `Invalid coverage for ${path}`);
  covered += hit; total += count;
  if (primary.includes(path)) assert.ok(hit / count >= .9, `${path}: custody line coverage below 90%`);
  console.log(`${path}: ${hit}/${count} lines (${(100 * hit / count).toFixed(2)}%)`);
}
assert.ok(covered / total >= .9, 'Aggregate custody and helper line coverage below 90%');
console.log(`PASS custody plus helpers: ${covered}/${total} lines (${(100 * covered / total).toFixed(2)}%). Branch coverage is reported separately, not certified by this threshold.`);
