import assert from "node:assert/strict";
import { parseExpectedFactories,validateFactorySupport,checkDeployedFactorySupport } from "./check-deployed-factory-support.mjs";
const address = n => "0x"+n.toString(16).padStart(40,"0");
const [basic,previous,older,current] = [1,2,3,4].map(address);
const expected=[basic,previous,older,current].join(",");
const payload=()=>({status:"success",automation:{enabled:true,supported:true,chainId:480,
  factoryAddresses:[basic,current,previous,older],factoryStatuses:[basic,current,previous,older].map(address=>({address,supported:true,reason:"verified"}))}});
let passed=0;
const check=async(name,test)=>{await test();passed++;console.log(`PASS ${name}`);};
await check("overlapping frontend/backend lists preserve every distinct generation",()=>{
  assert.deepEqual(parseExpectedFactories(`${expected}, ${previous.toUpperCase().replace("0X","0x")} ,${current}`),[basic,previous,older,current]);
  assert.deepEqual(validateFactorySupport(payload(),expected).expectedFactories,[basic,previous,older,current]);
});
await check("missing immediately previous primary blocks cutover even when new and oldest are supported",()=>{
  const p=payload();p.automation.factoryAddresses=p.automation.factoryAddresses.filter(x=>x!==previous);p.automation.factoryStatuses=p.automation.factoryStatuses.filter(x=>x.address!==previous);
  assert.throws(()=>validateFactorySupport(p,expected),/Expected factory missing/);
});
await check("listed address alone cannot stand in for supported status",()=>{
  const p=payload();p.automation.factoryStatuses.find(x=>x.address===previous).supported=false;
  assert.throws(()=>validateFactorySupport(p,expected),/lacks verified support/);
});
await check("status alone cannot stand in for deployed support list membership",()=>{
  const p=payload();p.automation.factoryAddresses=p.automation.factoryAddresses.filter(x=>x!==previous);
  assert.throws(()=>validateFactorySupport(p,expected),/missing/);
});
await check("wrong network, disabled automation and unsupported configuration fail closed",()=>{
  for(const patch of [{chainId:1},{chainId:"480"},{enabled:false},{supported:false}]){const p=payload();Object.assign(p.automation,patch);assert.throws(()=>validateFactorySupport(p,expected));}
});
await check("missing or ambiguous support evidence fails closed",()=>{
  for(const mutate of [p=>delete p.automation.factoryStatuses,p=>delete p.automation.factoryAddresses,p=>p.automation.factoryStatuses.push({...p.automation.factoryStatuses[0]}),p=>p.automation.factoryAddresses.push(basic),p=>p.automation.factoryStatuses[0].supported="true",p=>p.status="error"]){const p=payload();mutate(p);assert.throws(()=>validateFactorySupport(p,expected));}
});
await check("empty, malformed and zero expected addresses are rejected",()=>{
  for(const raw of [undefined,"",`${basic},`,`,${basic}`,`${basic},,${current}`,"0x123","0x"+"0".repeat(40),`${basic},not-an-address`])assert.throws(()=>parseExpectedFactories(raw));
});
await check("invalid reported addresses and malformed JSON structures fail closed",()=>{
  for(const mutate of [p=>p.automation.factoryAddresses[0]="bad",p=>p.automation.factoryStatuses[0].address="0x"+"0".repeat(40),p=>p.automation=null]){const p=payload();mutate(p);assert.throws(()=>validateFactorySupport(p,expected));}
  assert.throws(()=>validateFactorySupport(null,expected));
});
await check("HTTP verifier uses the real public response shape with no redirects",async()=>{
  const result=await checkDeployedFactorySupport({url:"https://worker.example/api/automation/health",expectedFactories:expected,fetchImpl:async(url,options)=>{
    assert.equal(url,"https://worker.example/api/automation/health");assert.equal(options.redirect,"error");assert.equal(options.headers.Accept,"application/json");return Response.json(payload());
  }});assert.equal(result.status,"verified");
});
await check("transport, non-JSON and HTTP failures block instead of authorizing release",async()=>{
  for(const fetchImpl of [async()=>{throw new Error("offline");},async()=>new Response("not json"),async()=>new Response("unavailable",{status:503})])await assert.rejects(checkDeployedFactorySupport({url:"https://worker.example/health",expectedFactories:expected,fetchImpl}));
  await assert.rejects(checkDeployedFactorySupport({url:"http://worker.example/health",expectedFactories:expected,fetchImpl:async()=>Response.json(payload())}));
});
console.log(`${passed} deployed factory support checks passed; no network requests or mutations.`);
