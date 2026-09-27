-- 단계별 알림 dedupe 상태.
--
-- 예전에는 notified_heir_address 한 개로 "상속인에게 보냈는가" 만 기억했는데,
-- 두 단계 상속에서 알림은 대상과 종류가 갈린다(상속인/피상속인 × 4단계).
-- JSON 으로 한 컬럼에 담는다 — D1 은 JSON 확장을 지원하지만, 스키마를 단순하게
-- 유지하는 편이 이 크기의 상태에는 낫다.
ALTER TABLE watchers ADD COLUMN alerts TEXT;
