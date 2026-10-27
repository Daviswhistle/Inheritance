import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "../app/node_modules/typescript/lib/typescript.js";
const localeSource = readFileSync(new URL("../app/src/locale.ts", import.meta.url), "utf8");
const localeJs = ts.transpileModule(localeSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const i18n = await import(`data:text/javascript;base64,${Buffer.from(localeJs).toString("base64")}`);
let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
};

await test("English and Korean dictionaries cover every required key and interpolation", () => {
    const englishKeys = Object.keys(i18n.dictionaries.en).sort();
    const koreanKeys = Object.keys(i18n.dictionaries.ko).sort();
    assert.deepEqual(koreanKeys, englishKeys);
    assert.deepEqual([...i18n.REQUIRED_LOCALE_KEYS].sort(), englishKeys);
    for (const key of englishKeys) {
      const english = i18n.dictionaries.en[key];
      const korean = i18n.dictionaries.ko[key];
      assert.ok(english.trim(), `English translation is empty for ${key}`);
      assert.ok(korean.trim(), `Korean translation is empty for ${key}`);
      const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
      assert.deepEqual(placeholders(korean), placeholders(english), `placeholder drift for ${key}`);
    }
    for (const prefix of ["entry.", "home.", "plan.", "income.", "history.", "nav.", "help."]) {
      assert.ok(englishKeys.some(key => key.startsWith(prefix)), `missing translated surface ${prefix}`);
    }
});

await test("explicit language preference overrides browser fallback and writes safely", () => {
    const values = new Map([[i18n.LOCALE_STORAGE_KEY, "en"]]);
    const storage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    assert.equal(i18n.resolveLocalePreference(storage, ["ko-KR", "en-US"]), "en");
    i18n.persistLocalePreference("ko", storage);
    assert.equal(values.get(i18n.LOCALE_STORAGE_KEY), "ko");
    assert.equal(i18n.resolveLocalePreference(storage, ["en-US"]), "ko");
});

await test("browser fallback follows the preferred locale and defaults safely to English", () => {
    assert.equal(i18n.resolveLocalePreference(null, ["ko-KR", "en-US"]), "ko");
    assert.equal(i18n.resolveLocalePreference(null, ["en-US", "ko-KR"]), "en");
    assert.equal(i18n.resolveLocalePreference(null, ["fr-FR", "ko-KR"]), "ko");
    assert.equal(i18n.resolveLocalePreference(null, ["fr-FR"]), "en");
    const blockedStorage = { getItem: () => { throw new Error("storage blocked"); }, setItem: () => { throw new Error("storage blocked"); } };
    assert.equal(i18n.resolveLocalePreference(blockedStorage, ["ko"]), "ko");
    assert.equal(i18n.persistLocalePreference("ko", blockedStorage), false);
    assert.equal(i18n.persistLocalePreference("en", null), false);
});

await test("English app and transaction labels match the interface", () => {
    assert.equal(i18n.translate("en", "entry.connect.continue"), "Agree and sign in");
    assert.equal(i18n.translate("en", "home.title.vault"), "Your plan");
    assert.equal(i18n.translate("en", "nav.money"), "Assets");
    assert.equal(i18n.translate("en", "plan.action.review"), "Review plan");
    assert.equal(i18n.translate("en", "plan.action.confirm"), "Open approval screen");
    assert.equal(i18n.translate("en", "income.title"), "Collect income");
    assert.equal(i18n.translate("en", "plan.legal.join"), "and");
    assert.equal(i18n.translate("en", "plan.balance.available", { amount: "1.25", symbol: "WLD" }), "Available: 1.25 WLD");
});

await test("wallet debit review and network fee copy keep deposits and fees separate", () => {
    assert.equal(i18n.translate("en", "plan.review.totalWalletDebit"), "Total wallet debit");
    assert.equal(i18n.translate("ko", "plan.review.totalWalletDebit"), "지갑 총차감액");
    assert.equal(i18n.translate("en", "plan.review.walletNetworkFee"), "+ WLD network fee (if charged)");
    assert.equal(i18n.translate("ko", "plan.review.walletNetworkFee"), "+ WLD 네트워크 수수료(발생하는 경우)");
    assert.match(i18n.translate("en", "plan.review.walletDebitQuote"), /deposit and fee quote together on World App’s approval screen.*cannot know the exact total in advance.*final debit is settled after the transaction/i);
    assert.match(i18n.translate("ko", "plan.review.walletDebitQuote"), /World App 승인 화면.*예치액과 수수료 견적.*정확한 합계를 미리 알 수 없으며.*최종 차감액은 거래 후 정산/);
    assert.match(i18n.translate("en", "fees.network.body"), /on top of deposits.*full entered amount goes to the vault/);
    assert.match(i18n.translate("ko", "fees.network.body"), /예치액에 더해.*입력한 금액 전부가 금고에 들어갑니다/);
    assert.match(i18n.translate("en", "fees.network.body"), /Vault creation.*additional deposits.*withdrawals.*can each incur a fee.*existing vaults are not guaranteed free/);
    assert.match(i18n.translate("ko", "fees.network.body"), /금고 생성.*추가 예치.*출금.*비용이 들 수 있고.*기존 금고도 무료가 보장되지 않습니다/);
    assert.match(i18n.translate("en", "fees.network.body"), /Inheritance’s service fee.*Re7’s strategy performance fee/);
    assert.match(i18n.translate("ko", "fees.network.body"), /Inheritance 서비스 수수료.*Re7 전략 성과 수수료와 별도/);
});

await test("Korean fee disclosures keep the 10 percent fee off principal", () => {
    for (const key of ["plan.risk.yieldFee", "income.feeDisclosure", "help.feeDisclosure"]) {
      const disclosure = i18n.translate("ko", key);
      assert.match(disclosure, /10%/);
    }
    for (const key of ["plan.risk.yieldFee", "income.feeDisclosure", "help.feeDisclosure"]) {
      assert.match(i18n.translate("ko", key), /원금/);
    }
    assert.match(i18n.translate("ko", "plan.risk.inheritance"), /7일/);
    assert.equal(i18n.translate("ko", "entry.connect.continue"), "동의하고 로그인");
    assert.equal(i18n.translate("ko", "plan.interval.daysSeconds", { days: 30, seconds: 3600 }), "30일 + 3600초");
});

await test("completed transaction messages reproject when language changes without losing diagnostics", () => {
    const completed = "Income collected. Your principal remains in the inheritance vault.";
    assert.equal(i18n.localizeAppMessage("en", completed), completed);
    assert.match(i18n.localizeAppMessage("ko", completed), /이자를 수령.*원금/);
    assert.match(i18n.localizeAppMessage("ko", "Checked in to all 3 active vaults."), /3개/);
    assert.match(i18n.localizeAppMessage("ko", "Pending… verifying USDC deposit"), /USDC 예치/);
    assert.equal(i18n.localizeAppMessage("ko", "Deposit error: RPC diagnostic 0x1234"), "예치 오류: RPC diagnostic 0x1234");
    assert.equal(i18n.localizeAppMessage("ko", "unrecognized provider diagnostic"), "unrecognized provider diagnostic");
    assert.equal(i18n.localizeAppMessage("ko", "Link copied."), "링크를 복사했습니다.");
    assert.equal(i18n.localizeAppMessage("ko", "Message copied."), "메시지를 복사했습니다.");
    assert.equal(i18n.localizeAppMessage("ko", "Not delivered: Check your World App notification settings."), "알림이 전달되지 않았습니다: World App의 알림 설정을 확인해 주세요.");
    assert.match(i18n.translate("ko", "automation.ready"), /직접 수령/);
    const strategyFeeEn = i18n.translate("en", "plan.risk.strategyFee", { symbol: "USDC", percent: 12 });
    const strategyFeeKo = i18n.translate("ko", "plan.risk.strategyFee", { symbol: "USDC", percent: 12 });
    assert.match(strategyFeeEn, /USDC.*Re7.*Morpho.*performance fee.*12%.*Inheritance/);
    assert.match(strategyFeeKo, /USDC.*Morpho.*Re7.*12%.*Inheritance/);
    assert.doesNotMatch(strategyFeeEn, /external investment vault/i);
    assert.match(i18n.translate("en", "plan.review.feeExampleLine", {
      symbol: "WLD", gross: "10 WLD", strategyFee: "1 WLD", strategyPercent: 10,
      remaining: "9 WLD", serviceFee: "0.9 WLD", net: "8.1 WLD",
    }), /10 WLD gross lending profit.*1 WLD Re7 strategy performance fee \(10%\).*9 WLD remaining.*0\.9 WLD Inheritance service fee.*8\.1 WLD illustrative net/);
    assert.match(i18n.translate("ko", "plan.review.feeExampleLine", {
      symbol: "USDC", gross: "10 USDC", strategyFee: "1 USDC", strategyPercent: 10,
      remaining: "9 USDC", serviceFee: "0.9 USDC", net: "8.1 USDC",
    }), /USDC별 예시: 대출 수익 10 USDC → Re7 전략 성과 수수료 1 USDC \(10%\) → 남은 금액 9 USDC → Inheritance 서비스 수수료 0\.9 USDC/);
});

await test("locale provider uses React context without mutating the document", () => {
    const source = readFileSync(new URL("../app/src/i18n.tsx", import.meta.url), "utf8");
    const context = readFileSync(new URL("../app/src/locale-context.ts", import.meta.url), "utf8");
    assert.match(context, /createContext/);
    assert.match(context, /useContext/);
    assert.match(source, /LocaleProvider/);
    assert.match(source, /LanguagePicker/);
    assert.doesNotMatch(`${source}\n${context}`, /document\.|MutationObserver|translate\.google/);
});

await test("every fixed app transaction status and toast has a Korean translation", () => {
    const source = ts.createSourceFile("App.tsx", readFileSync(new URL("../app/src/App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const missing = new Set();
    function visit(node) {
      if (ts.isCallExpression(node)) {
        const name = node.expression.getText(source);
        const argument = node.arguments[name === "pushToast" ? 1 : 0];
        if (["setStatus", "pushToast", "report"].includes(name) && argument && ts.isStringLiteral(argument)) {
          const message = argument.text;
          if (message && i18n.localizeAppMessage("ko", message) === message) missing.add(message);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    assert.deepEqual([...missing], []);
});

console.log(`${passed} passed, 0 failed`);
