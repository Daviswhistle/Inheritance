import type { AssetSymbol } from "@/assets";
import { Button } from "./ui/button";

export type AssetAccount = {
  address: string;
  factory: string;
  symbol: AssetSymbol;
  current: boolean;
};

/** Asset selection is a presentation layer; every action keeps its canonical account. */
export function AssetNavigation({ accounts, selected, busy, onSelect }: {
  accounts: AssetAccount[];
  selected: string;
  busy: boolean;
  onSelect: (account: AssetAccount) => void;
}) {
  const symbols = (["WLD", "USDC"] as AssetSymbol[]).filter(symbol => accounts.some(item => item.symbol === symbol));
  const selectedAccount = accounts.find(item => item.address.toLowerCase() === selected.toLowerCase());
  return <section className="asset-navigation" aria-label="Your assets">
    <div className="asset-switcher" role="group" aria-label="Choose an asset">
      {symbols.map(symbol => {
        const group = accounts.filter(item => item.symbol === symbol);
        const target = group.find(item => item.address.toLowerCase() === selected.toLowerCase())
          ?? group.find(item => item.current) ?? group[0];
        return <Button key={symbol} disabled={busy} aria-pressed={selectedAccount?.symbol === symbol}
          variant={selectedAccount?.symbol === symbol ? "primary" : "outline"}
          onClick={() => onSelect(target)}>
          <span className={`asset-token asset-token-${symbol.toLowerCase()}`} aria-hidden="true" />
          {symbol}
        </Button>;
      })}
    </div>
    {selectedAccount && accounts.filter(item => item.symbol === selectedAccount.symbol).length > 1 && <details className="asset-history">
      <summary>Other {selectedAccount.symbol} balances</summary>
      <p>Earlier deposits stay accessible. Choose the balance you want to manage; this does not move any funds.</p>
      <div className="grid gap-2">{accounts.filter(item => item.symbol === selectedAccount.symbol).map(item => <Button
        key={item.address} disabled={busy} aria-pressed={item.address.toLowerCase() === selected.toLowerCase()}
        variant={item.address.toLowerCase() === selected.toLowerCase() ? "primary" : "outline"}
        onClick={() => onSelect(item)}>
        {item.current ? "Current" : "Earlier"} {item.symbol} · {item.address.slice(0, 6)}…{item.address.slice(-4)}
      </Button>)}</div>
    </details>}
  </section>;
}
