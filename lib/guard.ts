// Design Ref: §6 보안 설계 — 서버 코드(API)가 일을 시작하기 전에 요청을 먼저 걸러 낸다.
// Plan SC: CHECK.md 2번(AI 호출 남용 방지)과 보안 S6(Content-Type·Origin 확인).

import { checkRateLimit, type RateLimitRule } from "./rate-limit";

export interface GuardOptions {
  /** 호출 횟수를 따로 세기 위한 이름 (예: "extract") */
  name: string;
  rule: RateLimitRule;
  /** 요청 본문 크기 상한(바이트). 본문을 읽기 전에 헤더로 먼저 거른다. */
  maxBodyBytes: number;
}

function reject(status: number, error: string, extraHeaders: Record<string, string> = {}) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store", ...extraHeaders } });
}

/** 요청을 보낸 곳의 주소. 프록시가 붙여 준 머리글을 쓰고, 없으면 하나의 공용 칸으로 센다. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * 요청을 검사한다. 통과하면 null, 막으면 그대로 돌려줄 응답을 돌려준다.
 * 1) JSON이 아니면 415  2) 다른 사이트에서 온 요청이면 403  3) 본문이 너무 크면 413  4) 호출이 너무 잦으면 429
 */
export function guardRequest(request: Request, options: GuardOptions): Response | null {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return reject(415, "JSON 형식의 요청만 받습니다.");
  }

  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("host") ?? new URL(request.url).host;
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      /* 읽을 수 없는 주소는 아래에서 거절한다 */
    }
    if (originHost !== host) {
      return reject(403, "허용되지 않은 출처의 요청입니다.");
    }
  }

  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > options.maxBodyBytes) {
    return reject(413, "요청이 너무 큽니다.");
  }

  const result = checkRateLimit(`${options.name}:${clientKey(request)}`, options.rule);
  if (!result.ok) {
    return reject(429, `요청이 너무 잦습니다. ${result.retryAfterSec}초 뒤에 다시 시도해 주세요.`, {
      "Retry-After": String(result.retryAfterSec),
    });
  }

  return null;
}
