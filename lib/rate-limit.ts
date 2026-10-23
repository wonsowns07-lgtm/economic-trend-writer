// Design Ref: §6 보안 설계 — 공개 주소의 AI 호출 남용을 막기 위한 호출 횟수 제한.
// Plan SC: CHECK.md 2번. 누구나 호출할 수 있는 서버 코드가 AI 비용을 마음대로 쓰지 못하게 한다.
// 주의: 이 제한은 서버 한 대(인스턴스)의 메모리 안에서만 센다. Vercel처럼 서버가 여러 대로 나뉘면 대수만큼 느슨해진다.
// 그래서 코드 밖의 방어(Vercel 방화벽 규칙, OpenAI 월 사용 한도)와 함께 써야 한다.

export interface RateLimitRule {
  /** 시간 창 안에서 허용하는 요청 수 */
  limit: number;
  /** 시간 창(밀리초). 기본 1분 */
  windowMs?: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** 막혔을 때 다시 시도할 수 있을 때까지 남은 시간(초) */
  retryAfterSec: number;
}

const DEFAULT_WINDOW_MS = 60_000;
/** 기억하는 사용자 수의 상한. 넘으면 오래된 것부터 버려 메모리가 무한히 늘지 않게 한다. */
const MAX_KEYS = 5_000;

const hits = new Map<string, number[]>();

/**
 * key(예: "extract:1.2.3.4")의 요청을 한 번 센다. 시간 창 안에서 limit을 넘으면 막는다.
 * @param now 시험에서 시간을 직접 정할 때 쓴다.
 */
export function checkRateLimit(key: string, rule: RateLimitRule, now: number = Date.now()): RateLimitResult {
  const windowMs = rule.windowMs ?? DEFAULT_WINDOW_MS;
  const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);

  if (recent.length >= rule.limit) {
    hits.set(key, recent);
    const oldest = recent[0];
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
  }

  recent.push(now);
  // 갱신된 키는 맨 뒤로 보내서(삭제 후 다시 넣기), 가장 오래 안 쓴 키가 맨 앞에 오게 한다.
  hits.delete(key);
  hits.set(key, recent);
  if (hits.size > MAX_KEYS) {
    const oldestKey = hits.keys().next().value;
    if (oldestKey !== undefined) hits.delete(oldestKey);
  }
  return { ok: true, retryAfterSec: 0 };
}

/** 시험에서 기록을 비울 때 쓴다. */
export function resetRateLimits(): void {
  hits.clear();
}
