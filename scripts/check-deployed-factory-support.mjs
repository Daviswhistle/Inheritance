// Read-only rollout gate. Supply every retained generation, including the previous
// primary. No factory defaults or .env loading can silently omit old contracts.
// AUTOMATION_HEALTH_URL=https://.../api/automation/health \
// EXPECTED_FACTORY_ADDRESSES=0x...,0x... node scripts/check-deployed-factory-support.mjs
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
const address = (value,label) => {
  assert.ok(typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value.trim()) && !/^0x0{40}$/i.test(value.trim()), `${label}: nonzero EVM address required`);
  return value.trim().toLowerCase();
};
export function parseExpectedFactories(csv) {
  assert.ok(typeof csv === "string" && csv.trim(), "Explicit expected factory list required");
  const tokens = csv.split(",");
  assert.ok(tokens.every(token => token.trim()), "Expected factory list contains an empty entry");
  // Frontend/backend legacy lists deliberately overlap. Repeated valid addresses
  // mean one expected contract, not grounds for omitting any generation.
  return [...new Set(tokens.map(token => address(token,"Expected factory")))];
}
export function validateFactorySupport(payload,expectedFactories,expectedChainId=480) {
  const expected = parseExpectedFactories(expectedFactories);
  assert.ok(Number.isSafeInteger(expectedChainId) && expectedChainId > 0,"Invalid expected chain ID");
  assert.equal(payload?.status,"success","Automation health response is not successful");
  const automation = payload.automation;
  assert.equal(automation?.enabled,true,"Automation is disabled");
  assert.equal(automation.supported,true,"Automation configuration is unsupported");
  assert.equal(automation.chainId,expectedChainId,"Automation health is on the wrong network");
  assert.ok(Array.isArray(automation.factoryAddresses),"Missing supported factory address list");
  assert.ok(Array.isArray(automation.factoryStatuses),"Missing factory support statuses");
  const listed = automation.factoryAddresses.map(value => address(value,"Health factory"));
  assert.equal(new Set(listed).size,listed.length,"Duplicate health factory addresses");
  const statuses = new Map();
  for (const row of automation.factoryStatuses) {
    const key = address(row?.address,"Factory status");
    assert.ok(!statuses.has(key),"Duplicate factory support status");
    assert.equal(typeof row.supported,"boolean","Factory support status is unknown");
    statuses.set(key,row.supported);
  }
  for (const key of listed) assert.equal(statuses.get(key),true,`Listed factory lacks verified support: ${key}`);
  for (const key of expected) {
    assert.ok(listed.includes(key),`Expected factory missing from deployed support list: ${key}`);
    assert.equal(statuses.get(key),true,`Expected factory is unsupported or unverified: ${key}`);
  }
  return {status:"verified",chainId:expectedChainId,expectedFactories:expected};
}
export async function checkDeployedFactorySupport({url,expectedFactories,expectedChainId=480,fetchImpl=globalThis.fetch}) {
  assert.ok(typeof url === "string" && url.trim(),"Explicit automation health URL required");
  const parsed = new URL(url);
  assert.equal(parsed.protocol,"https:","Automation health URL must use HTTPS");
  assert.ok(!parsed.username && !parsed.password,"Automation health URL must not contain credentials");
  const response = await fetchImpl(parsed.href,{redirect:"error",headers:{Accept:"application/json","Cache-Control":"no-cache"},signal:AbortSignal.timeout(20_000)});
  assert.ok(response.ok,`Automation health HTTP ${response.status}`);
  return validateFactorySupport(await response.json(),expectedFactories,expectedChainId);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = Object.fromEntries(process.argv.slice(2).reduce((pairs,value,index,all) => {
      if (index % 2 === 0) { assert.ok(["--url","--expected-factories","--chain-id"].includes(value) && all[index+1],"Expected named argument/value pairs"); pairs.push([value.slice(2),all[index+1]]); }
      return pairs;
    },[]));
    const chain = args["chain-id"] ?? process.env.EXPECTED_CHAIN_ID ?? "480";
    assert.ok(/^[1-9][0-9]*$/.test(chain),"Expected chain ID must be a positive integer");
    console.log(JSON.stringify(await checkDeployedFactorySupport({url:args.url ?? process.env.AUTOMATION_HEALTH_URL,
      expectedFactories:args["expected-factories"] ?? process.env.EXPECTED_FACTORY_ADDRESSES,expectedChainId:Number(chain)})));
  } catch (error) {
    console.error(JSON.stringify({status:"blocked",message:error.code === "ERR_ASSERTION" ? String(error.message).split("\n")[0] : "Could not verify deployed automation factory support"}));
    process.exitCode=1;
  }
}
