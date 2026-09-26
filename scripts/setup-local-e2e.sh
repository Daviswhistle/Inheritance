#!/usr/bin/env bash
# 로컬 E2E 환경 재구성: anvil 기동 → 토큰/팩토리 배포 → 테스트 지갑에 WLD 지급
# 사용법: ./scripts/setup-local-e2e.sh
set -euo pipefail

RPC=http://127.0.0.1:8546
CHAIN_ID=31337
OWNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266   # anvil 기본 계정 0
PK=$(grep -A3 'Private Keys' "${ANVIL_LOG:-/tmp/anvil.log}" 2>/dev/null | grep -oE '0x[0-9a-f]{64}' | head -1 || true)
PK=${PRIVATE_KEY:-$PK}

if [ -z "$PK" ]; then echo "anvil 로그에서 PRIVATE_KEY 를 찾지 못했습니다. ANVIL_LOG 를 지정하세요." >&2; exit 1; fi
export PRIVATE_KEY="$PK" CHAIN_ID

echo "==> 배포"
export WLD_ADDRESS=0x0
TOKEN=$(forge script script/DeployTestToken.s.sol:DeployTestToken \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --broadcast 2>&1 \
  | grep -oE 'TEST TOKEN: 0x[0-9a-fA-F]{40}' | awk '{print $3}')

export WLD_ADDRESS="$TOKEN"
FACTORY=$(forge script script/DeployWLDFactory.s.sol:DeployWLDFactory \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --broadcast 2>&1 \
  | grep -oE 'FACTORY: 0x[0-9a-fA-F]{40}' | awk '{print $2}')

echo "    token   = $TOKEN"
echo "    factory = $FACTORY"

echo "==> 테스트 계정에 WLD 지급"
cast send "$TOKEN" 'mint(address,uint256)' "$OWNER" 100000000000000000000 \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" > /dev/null
echo "    $OWNER : $(cast call "$TOKEN" 'balanceOf(address)(uint256)' "$OWNER" --rpc-url "$RPC")"

cat <<EOF

로컬 E2E 환경 준비 완료. app/.env 에 아래를 넣으세요:

  VITE_FACTORY_ADDRESS=$FACTORY
  VITE_WLD_ADDRESS=$TOKEN
  VITE_RPC=$RPC
  VITE_REQUIRE_VERIFY=false
  VITE_FACTORY_RELEASE_SUPPORTED=true
EOF
