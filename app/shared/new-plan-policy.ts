export const SUPPORTED_RESIDENCE_COUNTRIES = ["KR", "AR", "CO"] as const;

export type SupportedResidenceCountry = typeof SUPPORTED_RESIDENCE_COUNTRIES[number];
export type EdgeEligibility =
  | { state: "supported"; country: SupportedResidenceCountry }
  | { state: "unsupported"; country: string }
  | { state: "unavailable" };

const supported = new Set<string>(SUPPORTED_RESIDENCE_COUNTRIES);

function recognizedCountry(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const country = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country) || country === "XX") return null;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(country);
    return name && name !== country && name !== "Unknown Region" ? country : null;
  } catch {
    return null;
  }
}

/** Classify only Cloudflare's country value. Unknown values always fail closed. */
export function classifyEdgeCountry(value: unknown): EdgeEligibility {
  const country = recognizedCountry(value);
  if (!country) return { state: "unavailable" };
  if (supported.has(country)) return { state: "supported", country: country as SupportedResidenceCountry };
  return { state: "unsupported", country };
}
