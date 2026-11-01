import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet } from "../app/functions/api/eligibility.ts";
import {
  checkNewPlanAccess,
  clearResidenceAttestation,
  fetchEdgeEligibility,
  readResidenceAttestation,
  RESIDENCE_ATTESTATION_VERSION,
  saveResidenceAttestation,
} from "../app/src/new-plan-eligibility.ts";

const owner = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const other = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

function edgeRequest(country, url = "https://inheritance.pages.dev/api/eligibility?country=US", headers = {}) {
  const request = new Request(url, { headers });
  Object.defineProperty(request, "cf", { value: country === undefined ? undefined : { country } });
  return request;
}

async function endpoint(country, url, headers) {
  const response = await onRequestGet({ request: edgeRequest(country, url, headers) });
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.status, "success");
  return body.location;
}

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
}

const responseFor = location => Response.json({ status: "success", location });

test("Pages eligibility supports only KR, AR and CO and disables caching", async () => {
  for (const country of ["KR", "AR", "CO"]) {
    assert.deepEqual(await endpoint(country), { state: "supported", country });
  }
  for (const country of ["US", "GB", "SG"]) {
    assert.deepEqual(await endpoint(country), { state: "unsupported", country });
  }
});

test("spoofed geography headers and query parameters never replace request.cf.country", async () => {
  assert.deepEqual(await endpoint("US", "https://inheritance.pages.dev/api/eligibility?country=KR", {
    "cf-ipcountry": "KR", "x-country": "CO",
  }), { state: "unsupported", country: "US" });
  assert.deepEqual(await endpoint(undefined, "https://inheritance.pages.dev/api/eligibility?country=KR", {
    "cf-ipcountry": "KR", "x-country": "AR",
  }), { state: "unavailable" });
});

test("missing, unrecognized, T1 and XX edge values fail closed", async () => {
  for (const country of [undefined, null, "", "??", "ZZ", "T1", "XX", 480]) {
    assert.deepEqual(await endpoint(country), { state: "unavailable" }, String(country));
  }
});

test("each client authorization performs a fresh no-store request; a prior allow cannot survive a location change", async () => {
  const storage = new MemoryStorage();
  assert.equal(saveResidenceAttestation(owner, "KR", storage), true);
  const locations = [
    { state: "supported", country: "KR" },
    { state: "unsupported", country: "US" },
  ];
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url, init });
    return responseFor(locations.shift());
  };
  assert.equal((await checkNewPlanAccess(owner, fetcher, storage)).allowed, true);
  assert.deepEqual(await checkNewPlanAccess(owner, fetcher, storage), {
    allowed: false, reason: "unsupported-location", location: { state: "unsupported", country: "US" },
  });
  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ url, init }) => url === "/api/eligibility"
    && init.method === "GET" && init.cache === "no-store" && init.credentials === "same-origin"));
});

test("network errors and malformed replies prevent new sends", async () => {
  const storage = new MemoryStorage();
  saveResidenceAttestation(owner, "AR", storage);
  const failed = await checkNewPlanAccess(owner, async () => { throw new Error("offline"); }, storage);
  assert.equal(failed.allowed, false);
  assert.equal(failed.reason, "location-unavailable");
  const malformed = await checkNewPlanAccess(owner, async () => Response.json({ status: "success", location: { state: "supported", country: "US" } }), storage);
  assert.equal(malformed.allowed, false);
  assert.equal(malformed.reason, "location-unavailable");
});

test("missing, mismatched or old-version residence confirmation is denied", async () => {
  const storage = new MemoryStorage();
  const fetcher = async () => responseFor({ state: "supported", country: "AR" });
  assert.equal((await checkNewPlanAccess(owner, fetcher, storage)).reason, "residence-unconfirmed");
  assert.equal(saveResidenceAttestation(owner, "KR", storage), true);
  assert.equal(readResidenceAttestation(other, storage), null);
  storage.setItem(`inheritance:residence:${owner}`, JSON.stringify({
    version: RESIDENCE_ATTESTATION_VERSION - 1, account: owner, country: "KR", confirmed: true,
  }));
  assert.equal((await checkNewPlanAccess(owner, fetcher, storage)).reason, "residence-unconfirmed");
});

test("network location and user-declared residence are independent checks", async () => {
  const storage = new MemoryStorage();
  saveResidenceAttestation(owner, "KR", storage);
  const result = await checkNewPlanAccess(owner,
    async () => responseFor({ state: "supported", country: "AR" }), storage);
  assert.equal(result.allowed, true);
  if (result.allowed) assert.equal(result.residence, "KR");
});

test("unavailable local storage cannot record an attestation", () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(saveResidenceAttestation(owner, "CO", broken), false);
  assert.equal(readResidenceAttestation(owner, broken), null);
});

test("a hanging availability request times out to a retryable unavailable state", async () => {
  const fetcher = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  assert.deepEqual(await fetchEdgeEligibility(fetcher, 5), { state: "unavailable" });
});

test("changing residence removes the prior confirmation without affecting another wallet", () => {
  const storage = new MemoryStorage();
  saveResidenceAttestation(owner, "KR", storage);
  saveResidenceAttestation(other, "CO", storage);
  assert.equal(clearResidenceAttestation(owner, storage), true);
  assert.equal(readResidenceAttestation(owner, storage), null);
  assert.equal(readResidenceAttestation(other, storage), "CO");
});
