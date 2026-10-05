#!/usr/bin/env bash
# Clean-chain reset for the verification run: fresh anvil, mock WLD at its
# deterministic address, minted test accounts, fresh factory. Echoes the factory
# address so the dev server and the harness can both use it.
set -euo pipefail
cd "$(dirname "$0")/../.."

export PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export R=http://127.0.0.1:8546
export W=0x5FbDB2315678afecb367f032d93F642f64180aa3

pkill -f 'anvil --port 8546' 2>/dev/null || true
pkill -f 'vite.*7700' 2>/dev/null || true
sleep 2
nohup anvil --port 8546 --silent > /tmp/opencode/anvil.log 2>&1 &
sleep 4

TOK=$(PRIVATE_KEY=$PK CHAIN_ID=31337 forge script script/DeployTestToken.s.sol:DeployTestToken \
  --rpc-url $R --broadcast 2>&1 | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
[ "${TOK,,}" = "${W,,}" ] || { echo "  WLD 주소 불일치: $TOK"; exit 1; }
echo "  WLD: $TOK"

# 테스트 계정에 500 WLD. 주소는 하네스가 쓰는 것과 반드시 같아야 한다 —
# 손으로 옮기다가 오타가 나면 (주소 길이가 40 을 넘는다) cast 가 조용히 죽지 않는다.
node "$(dirname "$0")/mint.mjs"
echo "  민팅 완료"

FACTORY=$(PRIVATE_KEY=$PK WLD_ADDRESS=$W CHAIN_ID=31337 \
  forge script script/DeployWLDFactory.s.sol:DeployWLDFactory --rpc-url $R --broadcast 2>&1 \
  | grep -oE 'FACTORY: 0x[0-9a-fA-F]+' | awk '{print $2}')
echo "  FACTORY: $FACTORY"

cd app
nohup env VITE_RPC=$R VITE_FACTORY_ADDRESS=$FACTORY VITE_WLD_ADDRESS=$W VITE_FACTORY_DEPLOY_BLOCK=1 \
  VITE_LEGACY_FACTORY_ADDRESS= VITE_LEGACY_FACTORY_DEPLOY_BLOCK= \
  VITE_YIELD_FACTORY_ADDRESS= VITE_YIELD_FACTORY_DEPLOY_BLOCK= VITE_MORPHO_VAULT_ADDRESS= \
  VITE_USDC_ADDRESS= VITE_USDC_YIELD_FACTORY_ADDRESS= VITE_USDC_YIELD_FACTORY_DEPLOY_BLOCK= VITE_USDC_MORPHO_VAULT_ADDRESS= \
  VITE_LEGACY_YIELD_FACTORY_ADDRESSES= VITE_LEGACY_YIELD_FACTORY_DEPLOY_BLOCK= \
  VITE_LEGACY_USDC_YIELD_FACTORY_ADDRESSES= VITE_LEGACY_USDC_YIELD_FACTORY_DEPLOY_BLOCK= \
  VITE_NOTIFY_BACKEND_URL=https://world-inheritance-notify.rkddkwl725.workers.dev \
  npx vite --config vite.config.e2e.ts --port 7700 --strictPort > /tmp/opencode/dev.log 2>&1 &
sleep 8
echo "  dev 서버: HTTP $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7700/)"
echo "$FACTORY"
