// Audit reproduction. Runs the exact current source helpers with an unresolved
// optional display-name request. External reads are isolated; no network used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';

const repository = process.env.INHERITANCE_REPO || process.cwd();
const source = readFileSync(repository + '/app/src/App.tsx', 'utf8');
const { ethers } = createRequire(repository + '/app/package.json')('ethers');
function between(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}
function compile(code, context, names) {
  return new Function(...Object.keys(context), `${stripTypeScriptTypes(code, { mode: 'strip' })}\nreturn { ${names.join(', ')} };`)(...Object.values(context));
}
const microtasks = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const rawAddress = '0x2222222222222222222222222222222222222222';
let completeRawLookup;
let rawInputSettled = false;
const { resolveHeirInput } = compile(
  between('async function boundedProfile<', 'const INCOME_HISTORY_PAGE_BLOCKS') +
  between('  const resolveHeirInput = async (', '  // Debounced input handlers'),
  { ethers, loadMiniKit: async () => ({ MiniKit: {
    getUserByAddress: () => new Promise(resolve => { completeRawLookup = resolve; }),
  } }) }, ['resolveHeirInput'],
);
const rawResult = resolveHeirInput(rawAddress).then(result => { rawInputSettled = true; return result; });
await microtasks();
assert.equal(rawInputSettled, true, 'A valid address never waits for optional username metadata');
assert.equal(completeRawLookup, undefined);
assert.equal((await rawResult).address.toLowerCase(), rawAddress);

const account = '0x1111111111111111111111111111111111111111';
const position = { address: '0x3333333333333333333333333333333333333333',
  owner: rawAddress, heir: account, recipient: account, claimedAt: 0n };
const profiles = [];
let chainReadCount = 0;
let state = { account: account.toLowerCase(), loading: false, loaded: false, incomplete: false, positions: [] };
const callbackSource = between('  const refreshInheritedPositions = useCallback(', '  useEffect(() => {\n    void refreshInheritedPositions();');
const { refreshInheritedPositions } = compile(callbackSource, {
  useCallback: fn => fn, provider: {}, account, inheritedRequest: { current: 0 },
  setInheritedRead: update => { state = typeof update === 'function' ? update(state) : update; },
  heirFoundVaults: [position.address], linkedVault: '', rememberedInheritances: () => [],
  readInheritancePosition: async () => { chainReadCount++; return position; },
  ownerInheritancePositions: async () => [position],
  getUsernameFor: () => new Promise(resolve => { profiles.push(resolve); }),
  rememberInheritances: () => {},
}, ['refreshInheritedPositions']);

const first = refreshInheritedPositions();
await microtasks();
assert.equal(profiles.length, 1);
assert.equal(chainReadCount, 1);
assert.equal(state.positions.length, 1);
assert.equal(state.loading, false);
const snapshotWhileOnlyMetadataPending = { ...state, chainReadCount };

// Simulate the normal 30-second refresh firing before a slow profile call
// completes. A profile latency over the polling interval can repeat this.
const second = refreshInheritedPositions();
await microtasks();
profiles[0]('owner');
await first;
assert.equal(state.positions.length, 1, 'Verified chain assets remain actionable while names are pending');
const third = refreshInheritedPositions();
await microtasks();
profiles[1]('owner');
await second;
assert.equal(state.positions.length, 1);
const snapshotAfterOverlappingRefresh = { ...state, chainReadCount };
profiles[2]('owner');
await third;
assert.equal(state.positions.length, 1);
assert.equal(state.loaded, true);

void {
  sourceCommit: 'a9e93b10c6ddfd73f9a1139ab7fa0e361fa55199',
  realFundsUsed: false, networkUsed: false,
  rawAddress: { validAddress: rawAddress, blockedUntilOptionalProfileResolved: false },
  inheritanceList: { snapshotWhileOnlyMetadataPending, snapshotAfterOverlappingRefresh,
    afterProfileFinishesWithoutOverlap: { loaded: state.loaded, positions: state.positions.length } },
  limitation: 'Source-level dependency reproduction with controlled metadata promises; not a real network outage or device rendering test.',
};
console.log('PASS valid addresses and chain-confirmed inheritance remain actionable through stalled metadata and overlapping refreshes');
