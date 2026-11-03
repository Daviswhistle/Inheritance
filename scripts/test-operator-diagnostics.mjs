import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const appRequire=createRequire(resolve('app/package.json'));
const {build}=createRequire(appRequire.resolve('vite'))('esbuild');
const dir=mkdtempSync(tmpdir()+'/operator-diagnostics-');
await build({entryPoints:['scripts/operator-deploy/diagnostics.ts'],outfile:dir+'/diagnostics.mjs',bundle:true,platform:'node',format:'esm'});
const {sanitizeDebugUrl,sanitizeNativeDiagnostics}=await import(pathToFileURL(dir+'/diagnostics.mjs'));
for(const host of ['dashboard.tenderly.co','tenderly.co','trace.tenderly.co','developer.world.org']){
 assert.equal(sanitizeDebugUrl(`https://${host}/team/project/simulator/trace-123?token=PRIVATE_TOKEN#PRIVATE_FRAGMENT`),`https://${host}/team/project/simulator/trace-123`);
}
for(const input of ['http://dashboard.tenderly.co/trace','https://user:PRIVATE_PASSWORD@dashboard.tenderly.co/trace','https://dashboard.tenderly.co.evil.test/trace','https://evil.test/trace','javascript:alert(1)','https://developer.world.org:444/trace'])assert.equal(sanitizeDebugUrl(input),null);
const safe=sanitizeNativeDiagnostics({details:{debugUrl:'https://dashboard.tenderly.co/team/trace?token=PRIVATE_TOKEN#PRIVATE_FRAGMENT',debug_url:'https://evil.test/PRIVATE_PATH',signature:'PRIVATE_SIGNATURE',message:'https://example.test/PRIVATE_QUERY'}});
assert.equal(safe.details.debugUrl,'https://dashboard.tenderly.co/team/trace');assert.equal(safe.details.debug_url,'[omitted]');assert.doesNotMatch(JSON.stringify(safe),/PRIVATE_|evil.test|example.test/);
console.log('PASS official private trace URL: HTTPS host allowlist, no userinfo, query/fragment removed, arbitrary URLs omitted, no raw secrets');
