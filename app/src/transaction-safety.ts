const DEFINITELY_NOT_SUBMITTED_CODES = new Set([
  "user_rejected",
  "input_error",
  "simulation_failed",
  "invalid_contract",
  "invalid_operation",
  "disallowed_operation",
  "validation_error",
  "malicious_operation",
  "daily_tx_limit_reached",
  "permitted_amount_exceeds_slippage",
  "permitted_amount_not_found",
]);

/** Only structured MiniKit send errors with these codes prove no transaction was submitted. */
export function isDefinitelyNotSubmittedCode(code: unknown): code is string {
  return typeof code === "string" && DEFINITELY_NOT_SUBMITTED_CODES.has(code);
}

export function isDefinitelyNotSubmittedResponse(code: unknown, hasIdentifier: boolean): boolean {
  return !hasIdentifier && isDefinitelyNotSubmittedCode(code);
}
