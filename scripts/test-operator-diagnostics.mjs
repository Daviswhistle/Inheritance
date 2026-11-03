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
for(const host of ['dashboard.tenderly.co','tenderly.co','trace.tenderly.co','developer.world.org','tdly.co','trace.unknown-host.test']){
 assert.equal(sanitizeDebugUrl(`https://${host}/team/project/simulator/trace-123?token=PRIVATE_TOKEN#PRIVATE_FRAGMENT`),`https://${host}/team/project/simulator/trace-123`);
}
for(const input of ['http://dashboard.tenderly.co/trace','https://user:PRIVATE_PASSWORD@dashboard.tenderly.co/trace','javascript:alert(1)','https://developer.world.org:444/trace'])assert.equal(sanitizeDebugUrl(input),null);
const safe=sanitizeNativeDiagnostics({details:{debugUrl:'https://dashboard.tenderly.co/team/trace?token=PRIVATE_TOKEN#PRIVATE_FRAGMENT',debug_url:'http://rejected.test/PRIVATE_PATH',signature:'PRIVATE_SIGNATURE',message:'https://example.test/PRIVATE_QUERY'}});
assert.equal(safe.details.debugUrl,'https://dashboard.tenderly.co/team/trace');assert.equal(safe.details.debug_url,'[unsupported URL]');assert.equal(sanitizeNativeDiagnostics({details:{debugUrl:null}}).details.debugUrl,'[unavailable: null]');assert.equal(sanitizeNativeDiagnostics({details:{debugUrl:undefined}}).details.debugUrl,'[unavailable: undefined]');assert.equal(sanitizeNativeDiagnostics({details:{debugUrl:{}}}).details.debugUrl,'[unavailable: object]');assert.doesNotMatch(JSON.stringify(safe),/PRIVATE_|evil.test|example.test/);
console.log('PASS private trace URL: inert HTTPS text on any host, no userinfo, query/fragment removed, unsupported URLs omitted, no raw secrets');

assert.equal(sanitizeNativeDiagnostics({details:undefined}).details,'[unavailable: undefined]');
assert.equal(sanitizeNativeDiagnostics({details:null}).details,'[unavailable: null]');
assert.equal(sanitizeNativeDiagnostics({details:123}).details,'[unavailable: number]');
assert.equal(sanitizeNativeDiagnostics({details:true}).details,'[unavailable: boolean]');
assert.equal(sanitizeNativeDiagnostics({details:'Native value must be zero'}).details,'Native value must be zero');
const mixed=sanitizeNativeDiagnostics({details:['Native validation failed',{reason:'Empty calldata',signature:'PRIVATE_SIGNATURE'},null,undefined,'{"signature":"PRIVATE_SIG","nonce":"PRIVATE_NONCE","data":"0x1234567890abcdef"} https://example.test/PRIVATE_PATH',...Array(10).fill('padding')]});
assert.equal(mixed.details.length,6);assert.equal(mixed.details[1].reason,'Empty calldata');assert.doesNotMatch(JSON.stringify(mixed),/PRIVATE_|example.test|0x12345678/);
assert.ok(JSON.stringify(sanitizeNativeDiagnostics({details:Array(20).fill('x'.repeat(2000))})).length<2300);
console.log('PASS primitive/string/array native details: distinct types, bounded descriptions, nested allowlist and sensitive payload redaction');

const publicContract='0x091AD9e2e6e5eD44c1c66dB50e49A601F9f36cF6',publicApp='app_28c40a2a42b7f6c95789c2d5231b1314';
assert.deepEqual(sanitizeNativeDiagnostics({details:{contract:publicContract,miniappId:publicApp}}).details,{contract:publicContract,miniappId:publicApp});
for(const key of ['contract','miniappId']){
 for(const value of ['PRIVATE_RAW_VALUE','https://example.test/PRIVATE_TOKEN','0x1234','app_invalid',publicContract+'extra',publicApp+'extra'])assert.equal(sanitizeNativeDiagnostics({details:{[key]:value}}).details[key],'[unavailable: string]');
 for(const [value,type]of [[null,'null'],[undefined,'undefined'],[123,'number'],[{},'object'],[[],'object']])assert.equal(sanitizeNativeDiagnostics({details:{[key]:value}}).details[key],`[unavailable: ${type}]`);
}
assert.equal(sanitizeNativeDiagnostics({details:{contract:publicApp}}).details.contract,'[unavailable: string]');
assert.equal(sanitizeNativeDiagnostics({details:{miniappId:publicContract}}).details.miniappId,'[unavailable: string]');
console.log('PASS strict public contract/app identifiers preserved; malformed strings and primitive/object payloads not exposed');
