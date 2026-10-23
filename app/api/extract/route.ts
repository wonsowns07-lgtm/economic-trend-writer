// Design Ref: §4 폴더 구조 — app/api/extract/route.ts. 브라우저가 꺼낸 쪽별 글자를 받아 AI로 핵심 수치를 찾는다. (파일은 받지 않는다)
// Plan SC: PLAN 7번 작업. AI에는 수치 표가 있는 쪽의 공개자료 글자만 보낸다. 받은 글자는 저장하지 않고 기록(로그)에도 남기지 않는다.

import { AiError, askJson, type AiErrorKind } from "../../../lib/ai";
import { guardRequest } from "../../../lib/guard";
import {
  assembleIndicators,
  buildExtractionPrompt,
  ExtractionSchema,
  selectRelevantPages,
} from "../../../lib/extract";

/** 한 번에 받을 수 있는 쪽 수와 전체 글자 수. 88쪽·약 11만 자짜리 보도자료 기준으로 넉넉하게 잡았다. */
export const MAX_PAGES = 300;
export const MAX_TOTAL_CHARS = 300_000;

/** 호출 횟수 제한(사용자 주소마다 1분에 몇 번)과 요청 본문 크기 상한(바이트). 글자 30만 자는 JSON으로 약 1MB다. */
export const EXTRACT_RATE_LIMIT = { limit: 5 };
export const MAX_BODY_BYTES = 1_200_000;

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
  const blocked = guardRequest(request, { name: "extract", rule: EXTRACT_RATE_LIMIT, maxBodyBytes: MAX_BODY_BYTES });
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "요청 내용을 읽을 수 없습니다.");
  }

  const pages = (body as { pages?: unknown } | null)?.pages;
  if (!Array.isArray(pages) || pages.length === 0 || !pages.every((p) => typeof p === "string")) {
    return fail(400, "쪽별 글자(pages)를 문자열 목록으로 보내 주세요.");
  }
  if (pages.length > MAX_PAGES) {
    return fail(413, `쪽이 너무 많습니다. ${MAX_PAGES}쪽 이하의 자료를 올려 주세요.`);
  }
  const totalChars = pages.reduce((sum, page: string) => sum + page.length, 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return fail(413, "글자 양이 너무 많습니다. 더 짧은 자료를 올려 주세요.");
  }

  const selected = selectRelevantPages(pages as string[]);
  if (selected.length === 0) {
    return fail(422, "수치 표가 있는 쪽을 찾지 못했습니다. 산업활동동향 보도자료가 맞는지 확인해 주세요.");
  }

  let items;
  try {
    const answer = await askJson(ExtractionSchema, buildExtractionPrompt(selected), { maxTokens: 4_000 });
    items = answer.items;
  } catch (error) {
    if (error instanceof AiError) {
      // 자료 내용은 남기지 않고 오류의 종류만 남긴다.
      console.error("AI 수치 추출 실패:", error.kind);
      return fail(AI_ERROR_STATUS[error.kind], error.message);
    }
    console.error("AI 수치 추출 실패: 알 수 없는 오류");
    return fail(500, "수치를 찾는 중 문제가 생겼습니다. 잠시 뒤에 다시 시도해 주세요.");
  }

  const result = assembleIndicators(items, pages as string[]);
  return Response.json(
    { ...result, selectedPages: selected.map((p) => p.page) },
    { headers: NO_STORE },
  );
}
