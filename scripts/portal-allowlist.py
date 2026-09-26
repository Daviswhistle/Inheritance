#!/usr/bin/env python3
"""
포털 allowlist(Contract Entrypoints)를 API 로 직접 확인하고 보정한다.

왜 이게 필요한가 — MCP 의 `configure_mini_app` 은 contracts / permit2_tokens 를
**저장하지만** `get_app_config` 가 그 필드를 돌려주지 않는다. 그래서 정상 저장을
"미저장"으로 오진하고, 대시보드를 직접 만지라诱导하게 된다. 실제로는 저장돼 있었다.
쓰기 응답을 믿지 말고 GraphQL 로 다시 읽어 확인한다.

앱이 실제로 트랜잭션을 보내는 주소는 두 곳이다:
  1. WLD 토큰  — 입금 시 approve 의 대상
  2. 팩토리    — deposit / pingMyVault / fileClaimFor / finalizeClaimFor
하나라도 없으면 백엔드가 invalid_contract 로 막는다.

주의: urllib 로 이 GraphQL 엔드포인트는 403 이 된다(curl 은 된다). 환경에 따라
curl 로 폴백한다.
"""
import json
import pathlib
import re
import shutil
import subprocess
import tempfile

CONFIG = pathlib.Path.home() / ".config/opencode/opencode.jsonc"
ENDPOINTS = (
    "https://developer.world.org/api/v1/graphql",
    "https://developer.worldcoin.org/api/v1/graphql",
)

# 배포된 값 — app/.env.example 및 저장소 변수와 같아야 한다
FACTORY = "0x39721e856f5efa361b6428f056D437124F70C55E"
WLD = "0x2cfc85d8e48f8eab294be644d9e25c3030863003"
META_ID = "meta_9cf3b324ec9a1838a56c5b6d98be8674"

# 시그니처 — 대소문자를 정규화해서 비교한다. 실수로 여기서
# 팩토리 주소를 소문자로 바꾸지 않아 "누락" 으로 오진한 적이 있다.
REQUIRED = {
    WLD.lower(): "WLD 토큰 (approve 대상)",
    FACTORY.lower(): "팩토리 (입금/갱신/신청/수령)",
}

READ_QUERY = "{ app { app_metadata { id contracts permit2_tokens associated_domains } } }"
SET_MUTATION = """
mutation SetAllowlist($id: String!, $contracts: [String!], $permit: [String!]) {
  update_app_metadata_by_pk(
    _set: {contracts: $contracts, permit2_tokens: $permit}
    _where: {id: {_eq: $id}}
  ) { app_metadata { contracts permit2_tokens } }
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
    meta = res["data"]["app"][0]["app_metadata"][0]
    stored = {a.lower() for a in (meta.get("contracts") or [])}

    print("=== 저장된 allowlist (GraphQL 직접 조회) ===")
    for a in meta.get("contracts") or []:
        print("   ", a)
    print("  permit2_tokens:", meta.get("permit2_tokens") or "(비어 있음)")
    print("  associated_domains:", meta.get("associated_domains"))

    missing = [k for k in REQUIRED if k not in stored]
    if missing:
        print()
        print(f"  누락 {len(missing)}건 등록 시도: {missing}")
        out = gql(
            SET_MUTATION,
            {"id": META_ID, "contracts": [WLD, FACTORY], "permit": [WLD]},
        )
        if "errors" in out:
            print("  실패:", json.dumps(out["errors"])[:300])
            return 1

    # 쓰기 응답을 믿지 않고 다시 읽어 확정한다
    after = gql(READ_QUERY)["data"]["app"][0]["app_metadata"][0]
    final = {a.lower() for a in (after.get("contracts") or [])}
    print()
    print("=== 재조회로 확정 ===")
    ok = True
    for addr, label in REQUIRED.items():
        hit = addr in final
        ok &= hit
        print(f"  {label:28} {'등록됨' if hit else '누락'}")
    print()
    print("  판정:", "두 주소 모두 등록 — 트랜잭션 차단 위험 없음" if ok else "누락 있음")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
