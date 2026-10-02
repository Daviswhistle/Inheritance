// ethers can wrap provider failures in CALL_EXCEPTION even without EVM revert data.
// Only explicit hex revert data proves an execution failure; ambiguous errors must wait.
export function isExecutionRevert(error) {
  return error?.code === "CALL_EXCEPTION" && typeof error.data === "string" &&
    /^0x(?:[a-f0-9]{2})*$/i.test(error.data);
}
