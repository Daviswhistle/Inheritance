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
#   recovery           one failed identity read, restored controls and a real renewal.
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

# 단계 출력을 줄이지 않는다 — 특히 **실패 줄** 을.
#
# 예전에는 모든 단계를 `| tail -3` 으로 끝냈다. 통과할 때는 요약 한 줄이면 충분해서
# 그렇게 보였는데, 실패할 때는 그렇지 않다. "통과 30 / 실패 1" 이 찍히고 **어느 검사가
# 실패했는지** 는 잘려 나간다 — 로그에 답이 없다. 실제로 이 라운드에서 notify-ux 가
# 1건 실패해서 몇 분을 어디가 죽었는지 찾는 데 썼다.
#
# 그래서: 실패가 있으면 실패 줄을 **전부** 보고, 없으면 마지막 몇 줄만 본다.
show_stage() {
  local n="${1:-3}"; shift
  local tmp rc fails
  tmp="$(mktemp)"
  # **명령을 직접 실행한다.** 첫 구현은 `cat > "$tmp"` 로 stdin 만 읽었다 — 호출이
  # `show_stage 3 node …` 인데 함수가 실행하지 않으므로 8단계 전부 아무것도 안 찍혔다.
  # 검사가 조용히 사라지는 것보다 나쁜 실패다: 로그에 "단계는 돌았지만 결과가 없다" 가
  # 남으므로 통과로 오독된다. `"$@"` 로 실행해야 한다.
  "$@" > "$tmp" 2>&1
  rc=$?
  fails="$(grep -c '^  FAIL' "$tmp" || true)"
  if [[ "$fails" -gt 0 ]]; then
    # 실패가 있으면 **실패 줄 전부 + 요약 한 줄** 로 끝낸다. `tail` 과 같이 출력하면
    # 마지막 줄이 두 번 찍힌다(FAIL 줄이 마지막이라 grep 과 tail 에서 겹친다).
    grep -E '^  FAIL' "$tmp" || true
    tail -1 "$tmp"
  elif [[ "$rc" -ne 0 ]]; then
    # **크래시** — 검사 실패가 아니라 예외로 죽은 경우다. 이때는 `tail -1` 이
    # Node 의 스택 한 줄만 남겨서 "어디서 죽었는지"조차 안 보인다(그래서 아래 여유분을
    # 둔다). 크래시는 언제나 원인이 로그 어딘가에 있다.
    echo "  단계가 예외로 끝났다 (exit $rc) — 원인은 아래"
    tail -14 "$tmp"
  else
    tail -"$n" "$tmp"
  fi
  rm -f "$tmp"
  return "$rc"
}

# ── 선택자: 빌드와 무관하게 배포 바이트코드에서 확인 ───────────────
note "[1/8] 선택자 — 앱 ABI ↔ 배포 바이트코드"
if ! show_stage 4 node "$HERE/selectors.mjs"; then fails=$((fails+1)); fi

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
      note "[2/8] E2E — 브라우저에서 모든 상태 구동"
      FACTORY="$FACTORY_ADDR" show_stage 4 node "$HERE/verify.mjs" 2>&1
      ;;
    ux)
      note "[3/8] UX 감사 — 390x844, 8개 상태 × 전 탭"
      FACTORY="$FACTORY_ADDR" show_stage 3 node "$HERE/ux2.mjs" 2>&1
      ;;
    stale)
      # 반드시 마지막. 이 단계가 anvil 을 재시작한다.
      note "[7/8] 연결 두절 — 체인 죽음/복구"
      FACTORY="$FACTORY_ADDR" show_stage 3 node "$HERE/stale2.mjs" 2>&1
      ;;
    recovery)
      note "Role recovery — interrupted identity read and renewed timer"
      show_stage 3 node "$HERE/role-recovery.mjs" 2>&1
      ;;
    selection)
      note "Vault selection — verified routing and renewed shared-link sessions"
      show_stage 4 node "$HERE/vault-selection.mjs" 2>&1
      ;;
    discovery)
      note "Heir discovery — partial RPC failures and verified results on retry"
      show_stage 8 node "$HERE/heir-discovery.mjs" 2>&1
      ;;
    notify)
      note "[4/8] 알림 UX — 카운트다운 탭·자동 등록·신규 사용자 생성"
      FACTORY="$FACTORY_ADDR" show_stage 3 node "$HERE/notify-ux.mjs" 2>&1
      ;;
      rolematrix)
        note "[6/8] 역할 x 단계 x 탭 — 소유자 화법 누출"
        FACTORY="$FACTORY_ADDR" show_stage 3 node "$HERE/rolematrix.mjs" 2>&1
        ;;
      cancelled)
        note "[5/8] 취소된 금고 — 슬롯 해제와 두 번째 금고"
        FACTORY="$FACTORY_ADDR" show_stage 3 node "$HERE/cancelled.mjs" 2>&1
        ;;
    mainnet)
      note "[8/8] 메인넷 읽기 경로"
      show_stage 3 node "$HERE/mainnet-read.mjs" 2>&1
      ;;
  esac
  return $?
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
      for st in e2e ux notify cancelled rolematrix recovery selection discovery stale; do
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
