// Local operator setup. Private keys and signed state never enter output.
// Default is read-only. --prepare creates only a local dedicated bot key.
// --activate --broadcast grants a finite budget and bootstraps that bot once.
import { chmodSync, closeSync, existsSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Contract, Interface, JsonRpcProvider, Transaction, Wallet, formatEther, formatUnits, parseEther, parseUnits } from "ethers";
import { isExecutionRevert } from "../gas-refill/src/rpc-errors.mjs";

const CHAIN = 480, RPC = "https://worldchain-mainnet.g.alchemy.com/public";
const TREASURY = "0x93bC44B8296977Feb479F95855D9b9E051C17dA2";
const KEEPER = "0x8C31Bbc49C371d431f884aB18Ba5aA25B0D9170b";
const USDC = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1";
const CONFIGURED_BOT = "0x20A85A9e929C69A440938eb650d70619b7562eD5";
const KEY_FILE = resolve(".env.gas-refill"), STATE_FILE = resolve(".env.gas-refill-activation.json");
const LOCK_FILE = STATE_FILE + ".lock";
const ALLOWANCE = parseUnits("10", 6), BOOTSTRAP = parseEther("0.00001");
const MAX_FEE = 10_000_000n, EXTRA_FEE = parseEther("0.000001"), MAX_COST = parseEther("0.000015");
const tokenAbi = new Interface([
  "function decimals() view returns(uint8)", "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)", "function approve(address,uint256) returns(bool)",
  "event Approval(address indexed owner,address indexed spender,uint256 value)",
]);
const args = new Set(process.argv.slice(2));
const fail = message => { const error = new Error(message); error.publicMessage = message; throw error; };
for (const arg of args) if (!["--prepare", "--check", "--activate", "--broadcast"].includes(arg)) fail("Unknown setup option.");
if (args.has("--broadcast") !== args.has("--activate")) fail("Activation requires both --activate and --broadcast.");
if (args.has("--prepare") && (args.has("--activate") || args.has("--check"))) fail("Prepare and activation/check are separate steps.");

function privateRead(path) {
  if ((statSync(path).mode & 0o077) !== 0) fail("Private setup files must have mode 0600.");
  return readFileSync(path, "utf8");
}
function keyIn(text, name) {
  const value = text.match(new RegExp("^" + name + "\\s*=\\s*([^\\r\\n]+)$", "m"))?.[1]?.trim().replace(/^['"]|['"]$/g, "");
  if (!value || !/^0x[a-fA-F0-9]{64}$/.test(value)) fail("The expected local private key is missing or invalid.");
  return value;
}
function persist(state) {
  const tmp = STATE_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, STATE_FILE);
}
function validate(step, bot, signed) {
  const tx = Transaction.from(signed);
  const expectedData = step.kind === "approve" ? tokenAbi.encodeFunctionData("approve", [bot, ALLOWANCE]) : "0x";
  const expectedTo = step.kind === "approve" ? USDC : bot;
  const expectedValue = step.kind === "approve" ? 0n : BigInt(step.value);
  if (!['approve', 'fund'].includes(step.kind) || tx.from?.toLowerCase() !== TREASURY.toLowerCase() ||
    tx.to?.toLowerCase() !== expectedTo.toLowerCase() || tx.chainId !== BigInt(CHAIN) || tx.type !== 0 ||
    tx.data !== expectedData || tx.value !== expectedValue || expectedValue < 0n || expectedValue > BOOTSTRAP ||
    tx.nonce !== step.nonce || tx.gasPrice <= 0n || tx.gasPrice > MAX_FEE ||
    tx.gasLimit <= 0n || tx.gasLimit > (step.kind === "approve" ? 100_000n : 25_200n) ||
    tx.hash !== step.hash) fail("The private activation journal does not match the bounded setup transaction.");
  return tx;
}

async function extraFee(oracle, tx, gasLimit = tx.gasLimit, blockTag = "latest") {
  const l1 = BigInt(await oracle.getL1Fee(tx.unsignedSerialized, { blockTag }));
  let operator = 0n;
  try { operator = BigInt(await oracle.getOperatorFee(gasLimit, { blockTag })); }
  catch (error) { if (!isExecutionRevert(error)) throw error; }
  return l1 + operator;
}

let provider;
try {
  if (args.has("--activate") && process.env.INHERITANCE_SETUP_LOCK !== LOCK_FILE) {
    // Kernel flock survives process crashes without stale lease files. Keep this inode;
    // the lock is inherited by the child and covers every balance/nonce/journal read.
    closeSync(openSync(LOCK_FILE, "a", 0o600));
    chmodSync(LOCK_FILE, 0o600);
    const locked = spawnSync("flock", ["--nonblock", "--conflict-exit-code", "73", LOCK_FILE,
      process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
      env: { ...process.env, INHERITANCE_SETUP_LOCK: LOCK_FILE }, stdio: "inherit",
    });
    if (locked.error) fail("Activation requires the local flock utility; no setup funds were sent.");
    if (locked.status === 73) fail("Activation is already running; retry later with the same private journal.");
    process.exit(locked.status ?? 1);
  }
  if (args.has("--prepare")) {
    if (!existsSync(KEY_FILE)) {
      const bot = Wallet.createRandom();
      writeFileSync(KEY_FILE, `GAS_REFILL_PRIVATE_KEY=${bot.privateKey}\nGAS_REFILL_BOT_ADDRESS=${bot.address}\n`, { mode: 0o600, flag: "wx" });
    }
    const bot = new Wallet(keyIn(privateRead(KEY_FILE), "GAS_REFILL_PRIVATE_KEY"));
    console.log(JSON.stringify({ bot: bot.address, localKeyPrepared: true, privateFile: ".env.gas-refill",
      matchesConfiguredBot: bot.address.toLowerCase() === CONFIGURED_BOT.toLowerCase() }));
  } else {
    if (!existsSync(KEY_FILE)) fail("Run --prepare first to create the local dedicated bot key.");
    const bot = new Wallet(keyIn(privateRead(KEY_FILE), "GAS_REFILL_PRIVATE_KEY"));
    if (bot.address.toLowerCase() !== CONFIGURED_BOT.toLowerCase()) fail("The local bot key differs from the pinned Worker identity; review a key rotation before activation.");
    if ([TREASURY, KEEPER].some(address => address.toLowerCase() === bot.address.toLowerCase())) fail("The bot must be separate from treasury and executor.");
    provider = new JsonRpcProvider(RPC, CHAIN, { batchMaxCount: 1 });
    provider.pollingInterval = 1000;
    if ((await provider.getNetwork()).chainId !== BigInt(CHAIN)) fail("Unexpected chain.");
    const usdc = new Contract(USDC, tokenAbi, provider);
    const [decimals, treasuryETH, treasuryUSDC, botETH, botUSDC, allowance, gasPrice, botCode] = await Promise.all([
      usdc.decimals(), provider.getBalance(TREASURY), usdc.balanceOf(TREASURY), provider.getBalance(bot.address),
      usdc.balanceOf(bot.address), usdc.allowance(TREASURY, bot.address), provider.send("eth_gasPrice", []), provider.getCode(bot.address),
    ]);
    if (decimals !== 6n || botCode !== "0x") fail("Unexpected token decimals or bot account code.");
    const price = BigInt(gasPrice);
    if (price <= 0n || price > MAX_FEE) fail("Gas price is outside the activation limit.");
    const summary = { chainId: CHAIN, treasury: TREASURY, bot: bot.address, beneficiary: KEEPER,
      treasuryETH: formatEther(treasuryETH), treasuryUSDC: formatUnits(treasuryUSDC, 6),
      botETH: formatEther(botETH), botUSDC: formatUnits(botUSDC, 6), currentAllowanceUSDC: formatUnits(allowance, 6),
      finiteAllowanceUSDC: "10", bootstrapTargetETH: "0.00001", maxActivationCostETH: "0.000015" };
    if (!args.has("--activate")) {
      let reserve = 0n;
      if (allowance < ALLOWANCE) {
        const estimate = await provider.estimateGas({ from: TREASURY, to: USDC,
          data: tokenAbi.encodeFunctionData("approve", [bot.address, ALLOWANCE]), value: 0n });
        const gas = (estimate * 120n + 99n) / 100n;
        if (gas > 100_000n) fail("Approval estimate exceeds the setup limit.");
        reserve += gas * price + EXTRA_FEE;
      }
      if (botETH < BOOTSTRAP) reserve += BOOTSTRAP - botETH + 25_200n * price + EXTRA_FEE;
      console.log(JSON.stringify({ ...summary, readOnly: true, hasUSDCBudgetNow: treasuryUSDC > 0n || botUSDC > 0n,
        activationReserveETH: formatEther(reserve), activationFitsNativeBalance: reserve <= MAX_COST && treasuryETH >= reserve }));
    } else {
      const owner = new Wallet(keyIn(privateRead(resolve(".env.deploy")), "PRIVATE_KEY"), provider);
      if (owner.address.toLowerCase() !== TREASURY.toLowerCase()) fail("The local operator key does not match the fixed treasury.");
      const oracle = new Contract("0x420000000000000000000000000000000000000F", [
        "function getL1Fee(bytes) view returns(uint256)", "function getOperatorFee(uint256) view returns(uint256)",
      ], provider);
      let state = existsSync(STATE_FILE) ? JSON.parse(privateRead(STATE_FILE)) :
        { version: 1, chainId: CHAIN, treasury: TREASURY, bot: bot.address, steps: [], completed: false };
      if (state.version !== 1 || state.chainId !== CHAIN || state.treasury !== TREASURY || state.bot !== bot.address ||
        !Array.isArray(state.steps) || state.steps.length > 2) fail("Unexpected private activation journal identity.");
      if (!state.steps.length && !state.completed) {
        if (allowance > ALLOWANCE) fail("Existing bot allowance exceeds the setup bound; revoke it explicitly first.");
        const candidates = [];
        if (allowance < ALLOWANCE) candidates.push({ kind: "approve", to: USDC, value: 0n,
          data: tokenAbi.encodeFunctionData("approve", [bot.address, ALLOWANCE]) });
        if (botETH < BOOTSTRAP) candidates.push({ kind: "fund", to: bot.address, value: BOOTSTRAP - botETH, data: "0x" });
        const [latestNonce, pendingNonce] = await Promise.all([
          provider.getTransactionCount(TREASURY, "latest"), provider.getTransactionCount(TREASURY, "pending"),
        ]);
        if (latestNonce !== pendingNonce) fail("The treasury has another pending transaction; wait before activation.");
        let reserved = 0n;
        for (let i = 0; i < candidates.length; i++) {
          const candidate = candidates[i];
          const estimated = await provider.estimateGas({ from: TREASURY, to: candidate.to, value: candidate.value, data: candidate.data });
          const gas = (estimated * 120n + 99n) / 100n;
          if (gas > (candidate.kind === "approve" ? 100_000n : 25_200n)) fail("Activation gas estimate is outside the limit.");
          const raw = await owner.signTransaction({ to: candidate.to, value: candidate.value, data: candidate.data,
            chainId: CHAIN, type: 0, nonce: latestNonce + i, gasPrice: price, gasLimit: gas });
          if (await extraFee(oracle, Transaction.from(raw)) > EXTRA_FEE) fail("Activation extra fees exceed their reserve.");
          reserved += candidate.value + gas * price + EXTRA_FEE;
          const step = { kind: candidate.kind, value: candidate.value.toString(), nonce: latestNonce + i,
            raw, hash: Transaction.from(raw).hash, confirmed: false };
          validate(step, bot.address, raw);
          state.steps.push(step);
        }
        if (reserved > MAX_COST || treasuryETH < reserved) fail("Insufficient bounded activation funding.");
        persist(state);
      }
      const kinds = new Set();
      let journalReserve = 0n;
      for (let i = 0; i < state.steps.length; i++) {
        const step = state.steps[i], tx = validate(step, bot.address, step.raw);
        if (kinds.has(step.kind) || (i > 0 && (step.kind !== "fund" || tx.nonce !== state.steps[i - 1].nonce + 1))) {
          fail("The activation journal has duplicate or unordered setup transactions.");
        }
        kinds.add(step.kind);
        journalReserve += tx.value + tx.gasLimit * tx.gasPrice + EXTRA_FEE;
      }
      if (journalReserve > MAX_COST) fail("The stored activation transactions exceed the total setup bound.");
      for (const step of state.steps) {
        const tx = validate(step, bot.address, step.raw);
        let receipt = await provider.getTransactionReceipt(tx.hash);
        if (!receipt) {
          const [latestNonce, pendingNonce] = await Promise.all([
            provider.getTransactionCount(TREASURY, "latest"), provider.getTransactionCount(TREASURY, "pending"),
          ]);
          if (latestNonce > tx.nonce || pendingNonce > tx.nonce + 1) fail("Activation nonce has an unexpected transaction; inspect before retrying.");
          // L1/operator fees are outside the stored legacy gasPrice. Recheck on every resume.
          const currentExtra = await extraFee(oracle, tx);
          if (currentExtra > EXTRA_FEE || journalReserve - EXTRA_FEE + currentExtra > MAX_COST) {
            fail("Activation fees exceed the bounded reserve; retry later with the same private journal.");
          }
          const needed = tx.value + tx.gasLimit * tx.gasPrice + currentExtra;
          if (await provider.getBalance(TREASURY, "pending") < needed) fail("Insufficient treasury gas for this stored activation transaction.");
          try { await provider.broadcastTransaction(step.raw); } catch { /* Recover only this same signed hash. */ }
        }
        for (let attempt = 0; attempt < 45; attempt++) {
          receipt = await provider.getTransactionReceipt(tx.hash);
          if (receipt) {
            const [block, tip] = await Promise.all([provider.getBlock(receipt.blockNumber), provider.getBlockNumber()]);
            if (block?.hash === receipt.blockHash && tip >= receipt.blockNumber + 1) break;
          }
          await delay(1000);
        }
        if (!receipt) fail("Activation is pending; rerun the same command without deleting its private journal.");
        const [canonical, tip] = await Promise.all([provider.getBlock(receipt.blockNumber), provider.getBlockNumber()]);
        if (canonical?.hash !== receipt.blockHash || tip < receipt.blockNumber + 1) fail("Activation awaits canonical confirmation; rerun later.");
        if (receipt.status !== 1 || receipt.from.toLowerCase() !== TREASURY.toLowerCase() ||
          receipt.to?.toLowerCase() !== tx.to.toLowerCase()) fail("Activation transaction did not succeed as planned; inspect its public hash.");
        if (await extraFee(oracle, tx, receipt.gasUsed, receipt.blockNumber) > EXTRA_FEE) {
          fail("A confirmed activation transaction exceeded its fee reserve; inspect before continuing setup.");
        }
        if (step.kind === "approve") {
          const approval = receipt.logs.filter(log => log.address.toLowerCase() === USDC.toLowerCase())
            .map(log => { try { return tokenAbi.parseLog(log); } catch { return null; } })
            .find(log => log?.name === "Approval" && log.args.owner.toLowerCase() === TREASURY.toLowerCase() &&
              log.args.spender.toLowerCase() === bot.address.toLowerCase() && log.args.value === ALLOWANCE);
          if (!approval) fail("Finite USDC approval was not proven by its receipt.");
        }
        step.confirmed = true; step.blockNumber = receipt.blockNumber;
        persist(state);
        console.log(JSON.stringify({ phase: step.kind, hash: tx.hash, blockNumber: receipt.blockNumber, confirmed: true }));
      }
      state.completed = true; persist(state);
      console.log(JSON.stringify({ bot: bot.address, activationCompleted: true, finiteAllowanceUSDC: "10", bootstrapTargetETH: "0.00001" }));
    }
  }
} catch (error) {
  console.error(error.publicMessage || `Gas refill setup failed (${error.code || "local_error"}); private details suppressed.`);
  process.exitCode = 1;
} finally { provider?.destroy(); }
