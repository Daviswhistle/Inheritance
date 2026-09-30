#!/usr/bin/env bash
# Local verification suite.
#
# Why this exists: the bugs that actually cost users money were never caught by unit
# tests. They were found by driving the real UI against a real chain and comparing
# what the screen says against what the chain says. This makes that reproducible.
#
# What each stage checks, and what it has caught:
#   selectors.mjs      app ABI vs deployed bytecode.  A missing selector is not a
#                      build error — it is a deployed contract the app calls into a
#                      revert with no explanation.
#   e2e (verify.mjs)   every state, driven in a browser, each assert checked against
#                      `cast` output.  Caught the settled-residue sweep that existed
#                      in the contract but had no app path, the mislabelled withdraw
#                      button, the hard-coded "30" period default, and the deep link
#                      that was discarded for anyone who owned a vault.
#   ux (ux2.mjs)       390x844 across 8 account states x every tab: overflow, content
#                      hidden behind the tab bar, tap targets, empty tabs, stray CJK.
#   stale (stale2.mjs) chain dies mid-session, then recovers.
#   mainnet-read.mjs   the app's own read path against the deployed factory.
#
# Usage:
#   scripts/verify/run.sh            everything local
#   scripts/verify/run.sh e2e        one stage
#   scripts/verify/run.sh mainnet    read path against the live factory
set -uo pipefail
cd "$(dirname "$0")/../.."
HERE="$(pwd)/scripts/verify"

STAGE="${1:-all}"
export VERIFY_TMP="${VERIFY_TMP:-/tmp/wld-verify}"
mkdir -p "$VERIFY_TMP"

fails=0
note() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# ── 선택자: 빌드와 무관하게 배포 바이트코드에서 확인 ───────────────
note "[1/6] 선택자 — 앱 ABI ↔ 배포 바이트코드"
if ! node "$HERE/selectors.mjs" | tail -4; then fails=$((fails+1)); fi

# 로컬 체인이 필요한 단계
need_chain() {
  note "빈 체인을 만든다 (매번 같은 상태에서 재현되게)"
  FACTORY_ADDR="$(bash "$HERE/reset.sh" 2>/dev/null | tail -1)"
  if [[ ! "$FACTORY_ADDR" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    echo "  팩토리 배포 실패 — 로컬 단계를 건너뛴다"; return 1
  fi
  echo "  팩토리 $FACTORY_ADDR"
  return 0
}

run_stage() {
  case "$1" in
    e2e)
      note "[2/6] E2E — 브라우저에서 모든 상태 구동"
      FACTORY="$FACTORY_ADDR" node "$HERE/verify.mjs" 2>&1 | tail -4
      ;;
    ux)
      note "[3/6] UX 감사 — 390x844, 8개 상태 × 전 탭"
      FACTORY="$FACTORY_ADDR" node "$HERE/ux2.mjs" 2>&1 | tail -3
      ;;
    stale)
      # 반드시 마지막. 이 단계가 anvil 을 재시작한다.
      note "[6/6] 연결 두절 — 체인 죽음/복구"
      FACTORY="$FACTORY_ADDR" node "$HERE/stale2.mjs" 2>&1 | tail -3
      ;;
    notify)
      note "[4/6] 알림 UX — 카운트다운 탭·자동 등록·신규 사용자 생성"
      FACTORY="$FACTORY_ADDR" node "$HERE/notify-ux.mjs" 2>&1 | tail -3
      ;;
    mainnet)
      note "[6/6] 메인넷 읽기 경로"
      node "$HERE/mainnet-read.mjs" 2>&1 | tail -3
      ;;
  esac
  return "${PIPESTATUS[0]}"
}

if [[ "$STAGE" == "mainnet" ]]; then
  run_stage mainnet || fails=$((fails+1))
elif [[ "$STAGE" == "selectors" ]]; then
  :
else
  # 로컬 체인은 한 번만 만든다 — 단계마다 새로 만들면 앞 단계의 결과가 무의미해진다.
  if need_chain; then
    if [[ "$STAGE" == "all" ]]; then
      # stale 이 anvil 을 **재시작**한다(체인을 죽음/복구로 검증하므로). 그래서 마지막에
      # 둬야 한다. 앞에 두면 뒤 단계들이 초기화된 체인 — 그리고 다른 팩토리 주소 — 를
      # 상대로 돌아 조용히 실패한다. 실제로 그랬다.
      for st in e2e ux notify stale; do
        run_stage "$st" || fails=$((fails+1))
      done
      run_stage mainnet || fails=$((fails+1))
    else
      # 단계 하나만 지정된 경우 그 단계만 돌린다. 이전에는 어느 이름이든 전부 돌았다.
      run_stage "$STAGE" || fails=$((fails+1))
    fi
  else
    fails=$((fails+1))
  fi
fi

note "실패한 단계: $fails"
exit $((fails > 0 ? 1 : 0))
