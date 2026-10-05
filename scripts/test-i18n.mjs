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
    for (const prefix of ["landing.", "home.", "plan.", "income.", "history.", "nav.", "help."]) {
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

await test("English launch and transaction labels remain unchanged", () => {
    assert.equal(i18n.translate("en", "landing.connect.continue"), "Continue with World App");
    assert.equal(i18n.translate("en", "home.title.vault"), "Today, and for their tomorrow.");
    assert.equal(i18n.translate("en", "nav.money"), "Assets");
    assert.equal(i18n.translate("en", "plan.action.review"), "Review plan");
    assert.equal(i18n.translate("en", "plan.action.confirm"), "Confirm and deposit");
    assert.equal(i18n.translate("en", "income.title"), "Collect income");
    assert.equal(i18n.translate("en", "landing.assetChoice.both"), "WLD or USDC");
    assert.equal(i18n.translate("en", "plan.legal.join"), "and");
    assert.equal(i18n.translate("en", "plan.balance.available", { amount: "1.25", symbol: "WLD" }), "Available: 1.25 WLD");
});

await test("Korean fee disclosures keep the 10 percent fee off principal", () => {
    for (const key of ["landing.legal.yieldRisk", "plan.risk.yieldFee", "income.feeDisclosure", "help.feeDisclosure"]) {
      const disclosure = i18n.translate("ko", key);
      assert.match(disclosure, /10%/);
    }
    for (const key of ["plan.risk.yieldFee", "income.feeDisclosure", "help.feeDisclosure"]) {
      assert.match(i18n.translate("ko", key), /원금/);
    }
    assert.match(i18n.translate("ko", "plan.risk.inheritance"), /7일/);
    assert.equal(i18n.translate("ko", "landing.assetChoice.both"), "WLD 또는 USDC");
    assert.equal(i18n.translate("ko", "landing.amounts.both"), "WLD와 USDC 금액");
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
    assert.match(i18n.translate("ko", "automation.ready"), /직접 수령/);
    assert.match(i18n.translate("en", "plan.risk.strategyFee", { symbol: "USDC", percent: 12 }), /USDC.*12%.*before our service fee/);
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

console.log(`${passed} passed, 0 failed`);
