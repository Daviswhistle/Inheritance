## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

- **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
- **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
- **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
- **Chisel**: Fast, utilitarian, and verbose solidity REPL.

## Documentation

https://book.getfoundry.sh/

## Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

```shell
$ forge script script/Counter.s.sol:CounterScript --rpc-url <your_rpc_url> --private-key <your_private_key>
```

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```

## Mini App Notifications (Optional)

Notifications backend now uses Cloudflare Workers + D1 + Cron.

Quick start:

```shell
$ npx wrangler d1 create world-inheritance-notify
$ # put returned database_id into backend/wrangler.toml
$ npx wrangler secret put WORLD_APP_ID --config backend/wrangler.toml
$ npx wrangler secret put WORLD_NOTIFY_API_KEY --config backend/wrangler.toml
$ npm run notify:d1:remote
$ npm run notify:deploy
```

Local test:

```shell
$ npm run notify:d1:local
$ npm run notify:dev
```

Set frontend env:

```shell
$ VITE_NOTIFY_BACKEND_URL=https://<your-worker>.workers.dev
```

Details: `backend/README.md`
