// Design Ref: §2.2 2단계 — 꺼낸 글자에서 핵심 수치를 찾아 "수치 한 줄의 형태"(§2.3)로 돌려받는다.
// Plan SC: PLAN 7번 작업. AI가 읽은 값은 그대로 믿지 않고, 그 숫자가 인용한 쪽에 실제로 적혀 있는지 코드로 다시 확인한다.
// 확인이 안 된 칸은 빈칸으로 남겨 담당자가 직접 입력하게 한다. (틀린 수치가 조용히 들어오는 것을 막기 위함)

import { z } from "zod";
import { parseSigned } from "./growth";
import {
  COMPARISONS,
  INDICATOR_NAMES,
  type Comparison,
  type Indicator,
  type IndicatorName,
  type Unit,
} from "./indicators";

/** 이번 범위에서 찾는 수치. 지표·비교 기준·단위의 조합이다. */
export const EXPECTED_INDICATORS: ReadonlyArray<{
  name: IndicatorName;
  comparison: Comparison;
  unit: Unit;
}> = [
  { name: "전산업생산", comparison: "전월비", unit: "%" },
  { name: "전산업생산", comparison: "전년동월비", unit: "%" },
  { name: "소매판매", comparison: "전월비", unit: "%" },
  { name: "소매판매", comparison: "전년동월비", unit: "%" },
  { name: "설비투자", comparison: "전월비", unit: "%" },
  { name: "설비투자", comparison: "전년동월비", unit: "%" },
  { name: "경기동행지수", comparison: "전월차", unit: "p" },
  { name: "경기선행지수", comparison: "전월차", unit: "p" },
];

/**
 * 결과에 적는 표 이름. AI가 쓴 글을 응답에 그대로 싣지 않으려고(AI를 공짜 질문 통로로 쓰는 것을 막으려고) 서버가 정한 이름만 쓴다.
 */
export const TABLE_LABELS: Record<IndicatorName, string> = {
  전산업생산: "전산업생산",
  소매판매: "소매판매",
  설비투자: "설비투자",
  경기동행지수: "동행지수 순환변동치",
  경기선행지수: "선행지수 순환변동치",
};

/** AI가 돌려줘야 하는 답의 형태. 이 형태가 아니면 받지 않는다. */
export const ExtractionSchema = z.object({
  items: z.array(
    z.object({
      name: z.enum(INDICATOR_NAMES),
      comparison: z.enum(COMPARISONS),
      /** 어느 달의 수치인지. "2026-08"처럼 적는다. */
      period: z.string().regex(/^\d{4}-\d{2}$/),
      /** 문서에 적힌 숫자 그대로 (예: "-1.3"). 20자를 넘는 글은 숫자가 아니므로 잘라 낸다. */
      rawText: z.string().min(1).transform((text) => text.slice(0, 20)),
      /** 숫자가 있는 PDF 쪽 번호 (1부터) */
      page: z.number().int().min(1),
    }),
  ),
});
export type ExtractionItem = z.infer<typeof ExtractionSchema>["items"][number];

export interface SelectedPage {
  /** PDF 쪽 번호 (1부터) */
  page: number;
  text: string;
}

// 요약 표(전월비·전년동월비) 또는 경기지수 표(전월차(p))가 있는 쪽을 알아보는 표시
const TABLE_MARKER = /전월비\s+전년동월비|전월차\s*\(\s*p\s*\)/;
const INDICATOR_WORDS = /전산업생산|소매판매|설비투자|동행종합지수|선행종합지수|동행지수|선행지수/;
const COMPARISON_WORDS = /전월비|전월차/;

/**
 * 88쪽 전체를 AI에 보내지 않도록, 수치 표가 있는 쪽만 고른다. (비용·시간을 줄이고 엉뚱한 쪽의 숫자가 섞이는 것을 막는다.)
 * 표 표시가 있는 쪽을 우선하고, 하나도 없으면 지표 이름과 비교 말이 함께 나오는 쪽을 쓴다.
 */
/** AI로 보내는 글자 양의 상한. 남이 크게 만든 자료로 비용이 폭증하지 않게 한다. (실제 8월 자료는 7쪽, 약 8천 자)  */
export const AI_PAGE_CHAR_LIMIT = 8_000;
export const AI_TOTAL_CHAR_LIMIT = 40_000;

export function selectRelevantPages(
  pages: readonly string[],
  maxPages = 12,
  limits: { pageChars: number; totalChars: number } = { pageChars: AI_PAGE_CHAR_LIMIT, totalChars: AI_TOTAL_CHAR_LIMIT },
): SelectedPage[] {
  const numbered = pages.map((text, index) => ({ page: index + 1, text }));
  let chosen = numbered.filter((p) => TABLE_MARKER.test(p.text));
  if (chosen.length === 0) {
    chosen = numbered.filter((p) => INDICATOR_WORDS.test(p.text) && COMPARISON_WORDS.test(p.text));
  }
  // 쪽마다, 그리고 전체로 글자 수 상한을 넘지 않게 자른다.
  const selected: SelectedPage[] = [];
  let total = 0;
  for (const p of chosen.slice(0, maxPages)) {
    const text = p.text.slice(0, limits.pageChars);
    if (total + text.length > limits.totalChars) break;
    selected.push({ page: p.page, text });
    total += text.length;
  }
  return selected;
}

/** 보도자료 제목("2026년 8월 산업활동동향")에서 어느 달 자료인지 읽는다. 못 찾으면 null. */
export function derivePeriod(pages: readonly string[]): string | null {
  for (const text of pages.slice(0, 15)) {
    const match = /(\d{4})\s*년\s*(\d{1,2})\s*월\s*산업활동동향/.exec(text);
    if (match) return `${match[1]}-${match[2].padStart(2, "0")}`;
  }
  return null;
}

/** AI에게 줄 안내문과 자료를 만든다. */
export function buildExtractionPrompt(selected: readonly SelectedPage[]): { system: string; user: string } {
  const system = [
    "당신은 통계 보도자료에서 숫자를 옮겨 적는 도우미입니다. 숫자를 해석하거나 계산하거나 고치지 말고, 문서에 적힌 그대로만 옮기세요.",
    "",
    "찾을 것 (각각 가장 최근 달의 값 하나씩, 표에서 맨 아래 달 행):",
    "- 전산업생산, 소매판매, 설비투자: '전월비 전년동월비' 표에서 전월비와 전년동월비. (name: 전산업생산 / 소매판매 / 설비투자, comparison: 전월비 / 전년동월비)",
    "- 경기동행지수: '동행지수 순환변동치'의 '전월차(p)' 행에서 가장 최근 달 값. (name: 경기동행지수, comparison: 전월차)",
    "- 경기선행지수: '선행지수 순환변동치'의 '전월차(p)' 행에서 가장 최근 달 값. (name: 경기선행지수, comparison: 전월차)",
    "",
    "규칙:",
    "- rawText에는 문서에 적힌 숫자를 한 글자도 바꾸지 말고 그대로 복사하세요. 부호(-)와 소수점도 그대로 둡니다. 예: -1.3",
    "- 본문 문장('전월대비 1.8% 감소')이 아니라 표에 적힌 숫자를 쓰세요. 문장에는 부호가 없습니다.",
    "- page에는 그 숫자가 적힌 쪽 번호를, 아래 자료의 [N쪽] 표시를 보고 적으세요.",
    "- period는 그 숫자가 가리키는 달을 YYYY-MM 형식으로 적으세요. (예: 2026년 8월 → 2026-08)",
    "- 문서에서 찾지 못한 항목은 만들지 말고 빼세요. 추측하지 마세요.",
    '- 답은 {"items":[{"name":"","comparison":"","period":"","rawText":"","page":1}]} 형태입니다. (page는 1 이상의 쪽 번호)',
  ].join("\n");

  const user = selected.map((p) => `[${p.page}쪽]\n${p.text}`).join("\n\n");
  return { system, user };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 부호와 숫자만 있는 글자 (예: -1.3). 단위(%)나 설명이 붙은 글자는 표의 숫자가 아니므로 받지 않는다.
const BARE_NUMBER = /^[-−△+]?\d[\d,]*(?:\.\d+)?$/;
const NUMBER_TOKEN = /[-−]?\d+(?:\.\d+)?/g;

/**
 * 숫자(rawText)가 그 쪽의 "표 줄"에 실제로 적혀 있는지 본다.
 * - 더 긴 숫자의 일부(11.9 안의 1.9)이거나 부호만 다른 경우(-1.3 안의 1.3)는 같은 숫자로 보지 않는다.
 * - 본문 문장의 "전월대비 1.8% 감소"처럼 숫자가 하나뿐이고 %가 붙은 곳은 인정하지 않는다.
 *   (본문에는 부호가 없어서, 감소를 증가로 잘못 읽는 일을 막기 위함)
 * - 숫자가 두 개 이상 늘어선 줄(표의 한 줄)에 있어야 인정한다.
 */
export function isGroundedIn(pageText: string, rawText: string): boolean {
  if (!BARE_NUMBER.test(rawText)) return false;
  const token = new RegExp(`(?<![0-9.\\-−△+])${escapeRegExp(rawText)}(?![0-9%]|\\.\\d)`);
  return pageText
    .split("\n")
    .some((line) => token.test(line) && (line.match(NUMBER_TOKEN) ?? []).length >= 2);
}

export interface ExtractionResult {
  /** 어느 달 자료인지. 알 수 없으면 null */
  period: string | null;
  /** 찾는 수치마다 한 줄씩. 확인되지 않은 것은 "빈칸" */
  indicators: Indicator[];
  /** 담당자에게 알릴 말 (왜 빈칸인지 등) */
  warnings: string[];
}

function mostCommon(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * AI가 돌려준 항목을 "수치 한 줄의 형태"로 바꾼다.
 * 다음을 모두 통과한 것만 "추출됨"으로 하고, 나머지는 이유와 함께 "빈칸"으로 둔다.
 *  1) 기준 달과 같은 달이다. 2) 숫자로 읽을 수 있다. 3) 인용한 쪽에 그 숫자가 실제로 적혀 있다.
 */
export function assembleIndicators(
  items: readonly ExtractionItem[],
  pages: readonly string[],
  knownPeriod: string | null = derivePeriod(pages),
): ExtractionResult {
  const warnings: string[] = [];
  const period = knownPeriod ?? mostCommon(items.map((item) => item.period));
  if (period === null) {
    warnings.push("어느 달 자료인지 알 수 없어 모든 수치를 빈칸으로 두었습니다.");
  }

  const indicators: Indicator[] = EXPECTED_INDICATORS.map(({ name, comparison, unit }) => {
    const label = `${name} ${comparison}`;
    const blank: Indicator = {
      name,
      period: period ?? "",
      comparison,
      unit,
      source: null,
      indexes: null,
      value: null,
      status: "빈칸",
      rawText: null,
    };
    if (period === null) return blank;

    const candidates = items.filter((item) => item.name === name && item.comparison === comparison);
    if (candidates.length === 0) {
      warnings.push(`${label}: 문서에서 찾지 못해 빈칸으로 두었습니다. 직접 입력해 주세요.`);
      return blank;
    }

    for (const item of candidates) {
      if (item.period !== period) continue;
      const value = parseSigned(item.rawText);
      const pageText = pages[item.page - 1];
      if (value === null || pageText === undefined || !isGroundedIn(pageText, item.rawText)) continue;
      return {
        name,
        period,
        comparison,
        unit,
        source: { page: item.page, table: TABLE_LABELS[name] },
        indexes: null,
        value,
        status: "추출됨",
        rawText: item.rawText,
      };
    }

    warnings.push(`${label}: AI가 읽은 값을 ${period} 자료의 해당 쪽에서 확인하지 못해 빈칸으로 두었습니다. 직접 입력해 주세요.`);
    return blank;
  });

  return { period, indicators, warnings };
}
