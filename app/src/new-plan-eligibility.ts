import { classifyEdgeCountry, SUPPORTED_RESIDENCE_COUNTRIES } from "../shared/new-plan-policy.ts";
import type { EdgeEligibility, SupportedResidenceCountry } from "../shared/new-plan-policy.ts";

export type AccessBlockReason = "location-unavailable" | "unsupported-location" | "residence-unconfirmed";
export type NewPlanAccess =
  | { allowed: true; location: Extract<EdgeEligibility, { state: "supported" }>; residence: SupportedResidenceCountry }
  | { allowed: false; reason: AccessBlockReason; location: EdgeEligibility };

export type ResidenceStorage = Pick<Storage, "getItem" | "setItem">;
export const RESIDENCE_ATTESTATION_VERSION = 1;
const isSupportedResidence = (value: unknown): value is SupportedResidenceCountry =>
  typeof value === "string" && (SUPPORTED_RESIDENCE_COUNTRIES as readonly string[]).includes(value);
const validAccount = (account: string) => /^0x[0-9a-fA-F]{40}$/.test(account);
const residenceKey = (account: string) => `inheritance:residence:${account.toLowerCase()}`;

export function accessBlockMessage(reason: AccessBlockReason | "account-changed"): string {
  switch (reason) {
    case "unsupported-location": return "New vaults and deposits are unavailable from this network location.";
    case "location-unavailable": return "New plan and deposit availability could not be confirmed. Check again before retrying.";
    case "residence-unconfirmed": return "Confirm a supported current residence before creating a new vault or depositing.";
    case "account-changed": return "The active wallet changed. No new request was sent.";
  }
}

function localStorageOrNull(): ResidenceStorage | null {
  try { return globalThis.localStorage; }
  catch { return null; }
}

export function readResidenceAttestation(account: string, storage = localStorageOrNull()): SupportedResidenceCountry | null {
  if (!validAccount(account) || !storage) return null;
  try {
    const raw = storage.getItem(residenceKey(account));
    if (!raw) return null;
    const value = JSON.parse(raw) as { version?: unknown; account?: unknown; country?: unknown; confirmed?: unknown };
    return value.version === RESIDENCE_ATTESTATION_VERSION
      && value.account === account.toLowerCase() && value.confirmed === true && isSupportedResidence(value.country)
      ? value.country : null;
  } catch {
    return null;
  }
}

/** Store only the user's explicitly selected country, scoped to the signed-in wallet. */
export function saveResidenceAttestation(account: string, country: SupportedResidenceCountry,
  storage = localStorageOrNull()): boolean {
  if (!validAccount(account) || !isSupportedResidence(country) || !storage) return false;
  try {
    storage.setItem(residenceKey(account), JSON.stringify({
      version: RESIDENCE_ATTESTATION_VERSION,
      account: account.toLowerCase(),
      country,
      confirmed: true,
    }));
    return readResidenceAttestation(account, storage) === country;
  } catch {
    return false;
  }
}

export function clearResidenceAttestation(account: string, storage = localStorageOrNull()): boolean {
  if (!validAccount(account) || !storage) return false;
  try { storage.setItem(residenceKey(account), ""); return readResidenceAttestation(account, storage) === null; }
  catch { return false; }
}

export async function fetchEdgeEligibility(fetcher: typeof fetch = fetch, timeoutMs = 15_000): Promise<EdgeEligibility> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onPageHide = () => controller.abort();
  if (typeof window !== "undefined") window.addEventListener("pagehide", onPageHide, { once: true });
  try {
    const response = await fetcher("/api/eligibility", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return { state: "unavailable" };
    const body = await response.json() as { status?: unknown; location?: { state?: unknown; country?: unknown } };
    if (body.status !== "success" || !body.location || typeof body.location !== "object") {
      return { state: "unavailable" };
    }
    const classified = classifyEdgeCountry(body.location.country);
    return classified.state === body.location.state ? classified : { state: "unavailable" };
  } catch {
    return { state: "unavailable" };
  } finally {
    clearTimeout(timer);
    if (typeof window !== "undefined") window.removeEventListener("pagehide", onPageHide);
  }
}

/** The network check runs first on every call, even when local residence is missing. */
export async function checkNewPlanAccess(account: string, fetcher: typeof fetch = fetch,
  storage = localStorageOrNull()): Promise<NewPlanAccess> {
  const location = await fetchEdgeEligibility(fetcher);
  if (location.state === "unavailable") return { allowed: false, reason: "location-unavailable", location };
  if (location.state === "unsupported") return { allowed: false, reason: "unsupported-location", location };
  const residence = readResidenceAttestation(account, storage);
  if (!residence) return { allowed: false, reason: "residence-unconfirmed", location };
  return { allowed: true, location, residence };
}
