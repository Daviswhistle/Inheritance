export const isValidStrategyFeePercent = (fee: unknown): fee is number =>
  typeof fee === "number" && Number.isFinite(fee) && fee >= 0 && fee <= 100;

export function calculateIllustrativeFeeAmounts(strategyFeePercent: number | undefined) {
  if (!isValidStrategyFeePercent(strategyFeePercent)) return null;
  const grossLendingProfit = 10;
  const strategyFee = grossLendingProfit * strategyFeePercent / 100;
  const remaining = grossLendingProfit - strategyFee;
  const inheritanceServiceFee = remaining * 0.1;
  return { grossLendingProfit, strategyFee, remaining, inheritanceServiceFee, net: remaining - inheritanceServiceFee };
}
