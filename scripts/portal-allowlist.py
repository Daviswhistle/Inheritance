#!/usr/bin/env python3
"""
포털 allowlist(Contract Entrypoints)를 API 로 직접 확인하고 보정한다.

왜 이게 필요한가 — MCP 의 `configure_mini_app` 은 contracts / permit2_tokens 를
**저장하지만** `get_app_config` 가 그 필드를 돌려주지 않는다. 그래서 정상 저장을
"미저장"으로 오진하고, 대시보드를 직접 만지라诱导하게 된다. 실제로는 저장돼 있었다.
쓰기 응답을 믿지 말고 GraphQL 로 다시 읽어 확인한다.

앱이 실제로 트랜잭션을 보내는 주소는 세 곳이다:
  1. WLD 토큰  — 입금 시 approve 의 대상
  2. 현재 팩토리 — 새 금고 생성과 deposit / pingMyVault / fileClaimFor / finalizeClaimFor
  3. 기존 팩토리 — 해당 금고의 관리와 수동 수령
하나라도 없으면 백엔드가 invalid_contract 로 막는다.

주의: urllib 로 이 GraphQL 엔드포인트는 403 이 된다(curl 은 된다). 환경에 따라
curl 로 폴백한다.
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import sys

CONFIG = pathlib.Path.home() / ".config/opencode/opencode.jsonc"
ENDPOINTS = (
    "https://developer.world.org/api/v1/graphql",
    "https://developer.worldcoin.org/api/v1/graphql",
)

# 배포된 값 — app/.env 및 저장소 변수와 같아야 한다.
# 팩토리를 갈아끼울 때 여기도 같이 갱신해야 한다. 안 갱신하면 이 스크립트가 옛 주소를
# "누락" 으로 진단하고 되살리려 시도한다 — 실제로 교체된 팩토리를 allowlist 에
# 되돌릴 뻔했다.
FACTORY = "0xb74342FC15C504108cFD91366493590A9d570D26"
LEGACY_FACTORY = "0xF7BeEDDeB8bE1DbC4Bd8768fC3f1e513DD6C1d88"
WLD = "0x2cfc85d8e48f8eab294be644d9e25c3030863003"
META_ID = "meta_9cf3b324ec9a1838a56c5b6d98be8674"

# 시그니처 — 대소문자를 정규화해서 비교한다. 실수로 여기서
# 팩토리 주소를 소문자로 바꾸지 않아 "누락" 으로 오진한 적이 있다.
REQUIRED = {
    WLD.lower(): "WLD 토큰 (approve 대상)",
    FACTORY.lower(): "팩토리 (입금/갱신/신청/수령)",
    LEGACY_FACTORY.lower(): "기존 금고 팩토리 (수동 수령 포함)",
}
yield_factory = os.environ.get("YIELD_FACTORY_ADDRESS", "").strip()
morpho_vault = os.environ.get("MORPHO_VAULT_ADDRESS", "").strip()
if yield_factory or morpho_vault:
    if not all(re.fullmatch(r"0x[0-9a-fA-F]{40}", a) and int(a[2:], 16) for a in (yield_factory, morpho_vault)):
        raise SystemExit("수익 팩토리와 Morpho 금고 주소를 함께 설정해야 합니다")
    if yield_factory.lower() in REQUIRED or morpho_vault.lower() in REQUIRED or yield_factory.lower() == morpho_vault.lower():
        raise SystemExit("수익 팩토리와 전략은 기본 계약과 구분되어야 합니다")
    REQUIRED[yield_factory.lower()] = "수익 금고 팩토리 (선택형)"
    REQUIRED[morpho_vault.lower()] = "Re7 WLD 지분 토큰 (approve 대상)"

READ_QUERY = "{ app { app_metadata { id contracts permit2_tokens associated_domains verification_status } } }"
SET_MUTATION = """
mutation SetAllowlist($id: String!, $contracts: [String!], $permit: [String!]) {
  update_app_metadata_by_pk(
    _set: {contracts: $contracts, permit2_tokens: $permit}
    pk_columns: {id: $id}
  ) { contracts permit2_tokens }
}
"""


def api_key() -> str:
    txt = CONFIG.read_text()
    m = re.search(r'"Authorization"\s*:\s*"Bearer ([^"]+)"', txt)
    if not m:
        raise SystemExit("MCP 설정에서 API 키를 찾지 못했다")
    return m.group(1)


def gql(query: str, variables: dict | None = None) -> dict:
    """GraphQL 프록시 호출. urllib 은 403 이므로 curl 을 쓴다."""
    key = api_key()
    payload = json.dumps({"query": query, "variables": variables or {}})
    if not shutil.which("curl"):
        raise SystemExit("curl 이 필요합니다")
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        f.write(payload)
        path = f.name
    try:
        for url in ENDPOINTS:
            out = subprocess.run(
                [
                    "curl", "-s", "--max-time", "45", "-X", "POST", url,
                    "-H", f"Authorization: Bearer {key}",
                    "-H", "Content-Type: application/json",
                    "--data-binary", f"@{path}",
                ],
                capture_output=True, text=True,
            ).stdout
            if not out.strip():
                continue
            try:
                data = json.loads(out)
            except json.JSONDecodeError:
                continue
            if "errors" in data and "validation-failed" in json.dumps(data):
                # 이 엔드포인트가 아니면 다음으로
                if "no such" in json.dumps(data) or "not found" in json.dumps(data):
                    continue
            return data
        raise SystemExit("모든 엔드포인트 응답을 파싱하지 못했다")
    finally:
        pathlib.Path(path).unlink(missing_ok=True)


def main() -> int:
    res = gql(READ_QUERY)
    if "errors" in res:
        print("  읽기 실패:", json.dumps(res["errors"])[:200])
        return 1
    meta = next(m for app in res["data"]["app"] for m in app["app_metadata"] if m["id"] == META_ID)
    stored = {a.lower() for a in (meta.get("contracts") or [])}

    print("=== 저장된 allowlist (GraphQL 직접 조회) ===")
    for a in meta.get("contracts") or []:
        print("   ", a)
    print("  permit2_tokens:", meta.get("permit2_tokens") or "(비어 있음)")
    print("  associated_domains:", meta.get("associated_domains"))

    missing = [k for k in REQUIRED if k not in stored]
    if missing:
        if "--check-only" in sys.argv:
            print(f"  누락 {len(missing)}건; 읽기 전용 검사이므로 변경하지 않습니다")
            return 1
        if meta.get("verification_status") != "unverified":
            print("  포털에서 Remove from review로 심사를 취소한 뒤 다시 실행하세요.")
            print("  현재 상태에서는 API가 설정 변경을 허용하지 않습니다:", meta.get("verification_status"))
            return 1
        print()
        print(f"  누락 {len(missing)}건 등록 시도: {missing}")
        out = gql(
            SET_MUTATION,
            {"id": META_ID, "contracts": list(dict.fromkeys([*(meta.get("contracts") or []), *REQUIRED])), "permit": list(dict.fromkeys([*(meta.get("permit2_tokens") or []), WLD]))},
        )
        if "errors" in out:
            print("  실패:", json.dumps(out["errors"])[:300])
            return 1

    # 쓰기 응답을 믿지 않고 다시 읽어 확정한다
    after = next(m for app in gql(READ_QUERY)["data"]["app"] for m in app["app_metadata"] if m["id"] == META_ID)
    final = {a.lower() for a in (after.get("contracts") or [])}
    print()
    print("=== 재조회로 확정 ===")
    ok = True
    for addr, label in REQUIRED.items():
        hit = addr in final
        ok &= hit
        print(f"  {label:28} {'등록됨' if hit else '누락'}")
    print()
    print("  판정:", "필수 주소 등록 확인" if ok else "누락 있음")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
