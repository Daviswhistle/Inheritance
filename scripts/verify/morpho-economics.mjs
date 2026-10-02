// Read-only World Chain evidence. Annualizes the rate returned by each IRM over
// its last-update window; this is an indicative estimate, never future earnings.
import assert from "node:assert/strict";
import { Contract, JsonRpcProvider, ZeroAddress, formatEther } from "ethers";

const provider = new JsonRpcProvider("https://worldchain-mainnet.g.alchemy.com/public", undefined, { batchMaxCount: 1 });
const address = "0x348831b46876d3dF2Db98BdEc5E3B4083329Ab9f";
try {
  assert.equal(BigInt(await provider.send("eth_chainId", [])), 480n);
  const blockNumber = Number(process.env.MORPHO_ECONOMICS_BLOCK) || await provider.getBlockNumber();
  const options = { blockTag: blockNumber };
  const block = await provider.getBlock(blockNumber);
  const vault = new Contract(address, ["function MORPHO() view returns(address)", "function fee() view returns(uint256)",
    "function withdrawQueueLength() view returns(uint256)", "function withdrawQueue(uint256) view returns(bytes32)",
    "function totalAssets() view returns(uint256)"], provider);
  const [blue, fee, count, total] = await Promise.all([vault.MORPHO(options), vault.fee(options), vault.withdrawQueueLength(options), vault.totalAssets(options)]);
  assert.ok(count > 0n && count <= 32n && total > 0n && fee <= 10n ** 18n);
  const morpho = new Contract(blue, [
    "function market(bytes32) view returns(uint128 totalSupplyAssets,uint128 totalSupplyShares,uint128 totalBorrowAssets,uint128 totalBorrowShares,uint128 lastUpdate,uint128 fee)",
    "function idToMarketParams(bytes32) view returns(address loanToken,address collateralToken,address oracle,address irm,uint256 lltv)",
    "function position(bytes32,address) view returns(uint256 supplyShares,uint128 borrowShares,uint128 collateral)",
  ], provider);
  const markets = await Promise.all(Array.from({ length: Number(count) }, async (_, index) => {
    const id = await vault.withdrawQueue(index, options);
    const [market, params, position] = await Promise.all([morpho.market(id, options), morpho.idToMarketParams(id, options), morpho.position(id, address, options)]);
    assert.equal(params.loanToken.toLowerCase(), "0x2cfc85d8e48f8eab294be644d9e25c3030863003");
    const allocation = market.totalSupplyShares === 0n ? 0 : Number(position.supplyShares) * Number(market.totalSupplyAssets) / Number(market.totalSupplyShares);
    let rate = 0n;
    if (params.irm !== ZeroAddress && allocation > 0) {
      const irm = new Contract(params.irm, ["function borrowRateView((address,address,address,address,uint256),(uint128,uint128,uint128,uint128,uint128,uint128)) view returns(uint256)"], provider);
      rate = await irm.borrowRateView([...params], [...market], options);
    }
    const utilization = market.totalSupplyAssets === 0n ? 0 : Number(market.totalBorrowAssets) / Number(market.totalSupplyAssets);
    const supplyAPY = Math.expm1(Number(rate) / 1e18 * 365 * 86400) * utilization * (1 - Number(market.fee) / 1e18);
    return { id, irm: params.irm, assetsWLD: allocation / 1e18, utilization, supplyAPY, rateWeiPerSecond: rate.toString(),
      rateWindowSeconds: Number(block.timestamp) - Number(market.lastUpdate) };
  }));
  const gross = markets.reduce((sum, market) => sum + market.supplyAPY * market.assetsWLD, 0) / (Number(total) / 1e18);
  const net = gross * (1 - Number(fee) / 1e18);
  console.log(JSON.stringify({ block: blockNumber, chainTimestamp: new Date(block.timestamp * 1000).toISOString(), vault: address,
    underlyingFee: Number(fee) / 1e18, totalWLD: formatEther(total), markets, approxGrossLendingAPY: gross,
    approxAfterUnderlyingFeeAPY: net, annualServiceFeeWLDPer1000000TVL: net * 0.1 * 1000000,
    method: "IRM borrowRateView -> borrow APY, times utilization and market fee; current stored allocation weighting and vault fee; incentive rewards excluded; indicative annualization, not future earnings" }, null, 2));
} finally { provider.destroy(); }
