// Design Ref: §4 폴더 구조 — app/api/summary/route.ts. 검증을 통과한 수치만 받아 종합평가 초안을 AI로 쓴다.
// Plan SC: PLAN 12번 작업. 작성본과 PDF 글자는 받지 않는다. 받은 수치는 저장하지 않고 기록(로그)에도 남기지 않는다.

import { AiError, askText, type AiErrorKind } from "../../../lib/ai";
import { requireAuth } from "../../../lib/auth";
import { guardRequest } from "../../../lib/guard";
import {
  allowedNumbers,
  buildSummaryPrompt,
  findUnsupportedNumbers,
  SummaryInputSchema,
} from "../../../lib/summary";

/** 호출 횟수 제한(사용자 주소마다 1분에 몇 번)과 요청 본문 크기 상한(바이트). 수치 20개짜리 요청은 2KB 안팎이다. */
export const SUMMARY_RATE_LIMIT = { limit: 10 };
export const MAX_BODY_BYTES = 20_000;

const NO_STORE = { "Cache-Control": "no-store" };

function fail(status: number, error: string) {
  return Response.json({ error }, { status, headers: NO_STORE });
}

const AI_ERROR_STATUS: Record<AiErrorKind, number> = {
  설정: 500,
  인증: 502,
  한도: 429,
  "시간 초과": 504,
  연결: 502,
  "응답 형식": 502,
  "알 수 없음": 502,
};

export async function POST(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;
  const blocked = guardRequest(request, { name: "summary", rule: SUMMARY_RATE_LIMIT, maxBodyBytes: MAX_BODY_BYTES });
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "요청 내용을 읽을 수 없습니다.");
  }

  const parsed = SummaryInputSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, "검증을 통과한 수치(period, items)를 올바른 형태로 보내 주세요.");
  }
  const input = parsed.data;
  const allowed = allowedNumbers(input);
  const prompt = buildSummaryPrompt(input);

  try {
    let text = await askText(prompt);
    let unsupported = findUnsupportedNumbers(text, allowed);

    // 근거 없는 숫자가 섞였으면 한 번만 다시 쓰게 한다.
    if (unsupported.length > 0) {
      text = await askText({
        system: prompt.system,
        user: `${prompt.user}\n\n앞선 글에 사용할 수치에 없는 숫자(${unsupported.join(", ")})가 있었습니다. 사용할 수치의 숫자만 쓰고 다시 쓰세요.`,
      });
      unsupported = findUnsupportedNumbers(text, allowed);
    }

    if (unsupported.length > 0) {
      console.error("종합평가 초안 실패: 근거 없는 숫자가 섞임");
      return fail(502, "AI가 제공하지 않은 숫자를 써서 초안을 받지 않았습니다. 다시 시도해 주세요.");
    }

    return Response.json({ text, usedCount: input.items.length }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AiError) {
      console.error("종합평가 초안 실패:", error.kind);
      return fail(AI_ERROR_STATUS[error.kind], error.message);
    }
    console.error("종합평가 초안 실패: 알 수 없는 오류");
    return fail(500, "초안을 만드는 중 문제가 생겼습니다. 잠시 뒤에 다시 시도해 주세요.");
  }
}
