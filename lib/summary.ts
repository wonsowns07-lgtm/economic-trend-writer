// Design Ref: §2.2 6단계 — 검증을 통과한 수치로만 종합평가 문장을 쓴다. 작성본과 PDF 글자는 보내지 않고 수치만 보낸다.
// Plan SC: PLAN 12번 작업. AI가 쓴 글의 숫자가 보낸 수치와 같은지 코드로 다시 확인해, 근거 없는 숫자가 섞인 초안은 받지 않는다.

import { z } from "zod";
import { formatSigned } from "./growth";
import { COMPARISONS, INDICATOR_NAMES, UNITS } from "./indicators";

/** 초안에 쓸 수치 한 줄. 화면에서 검증을 통과한 줄만 서버로 보낸다. */
export const SummaryInputSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  items: z
    .array(
      z.object({
        name: z.enum(INDICATOR_NAMES),
        comparison: z.enum(COMPARISONS),
        unit: z.enum(UNITS),
        value: z.number().finite(),
      }),
    )
    .min(1)
    .max(20),
});
export type SummaryInput = z.infer<typeof SummaryInputSchema>;
export type SummaryItem = SummaryInput["items"][number];

/** 값의 부호로 방향을 정한다. 경기지수의 전월차는 상승/하락, 나머지는 증가/감소로 쓴다. */
export function directionWord(item: Pick<SummaryItem, "comparison" | "value">): string {
  const rising = item.comparison === "전월차" ? "상승" : "증가";
  const falling = item.comparison === "전월차" ? "하락" : "감소";
  if (item.value > 0) return rising;
  if (item.value < 0) return falling;
  return "보합";
}

/** 화면에 적는 표기. 감소는 △, 단위가 지수이면 단위를 붙이지 않는다. 예: △1.3% */
export function formatItem(item: Pick<SummaryItem, "unit" | "value">): string {
  return formatSigned(item.value, item.unit === "지수" ? "" : item.unit);
}

/** "2026-08" → { year: "2026", short: "26", month: "8" } */
function periodParts(period: string) {
  const [year, month] = period.split("-");
  return { year, short: year.slice(2), month: String(Number(month)) };
}

/** AI에게 줄 안내문. 숫자는 코드가 미리 표기해 주고, AI는 그대로 옮기게 한다. */
export function buildSummaryPrompt(input: SummaryInput): { system: string; user: string } {
  const { year, short, month } = periodParts(input.period);
  const system = [
    "당신은 재정경제부 「최근경제동향」의 종합평가 초안을 쓰는 도우미입니다.",
    "'사용할 수치'에 있는 수치만으로, 산업활동동향 부분(생산·소비·투자·경기지수)의 종합평가 문장을 개조식으로 쓰세요.",
    "",
    "규칙:",
    "- 숫자는 '사용할 수치'에 적힌 표기를 한 글자도 바꾸지 말고 그대로 쓰세요. 계산하거나 반올림하거나 새 숫자를 만들지 마세요.",
    "- 증가·감소·상승·하락은 각 수치의 '방향'을 그대로 따르세요.",
    "- 원인, 전망, 평가를 단정하지 마세요. 수출·고용·물가·금융·주택 등 제공되지 않은 내용은 쓰지 마세요.",
    "- 제공되지 않은 지표는 언급하지 마세요.",
    "- 문장은 명사형으로 끝내는 개조식입니다. 번호를 붙이지 말고 줄머리에 '▪'만 쓰세요.",
    "- 기준 달은 'ʼ" + short + "." + month + "월'처럼 쓸 수 있습니다.",
    "",
    "형식 예시 (X, Y는 자리표시자이니 숫자를 따라 쓰지 마세요):",
    "ʼ" + short + "." + month + "월 산업활동동향 주요지표는 전산업생산, 소매판매 감소",
    "▪ 생산은 전산업생산(전월비 △X%, 전년비 Y%) 감소",
    "▪ 지출은 소매판매(전월비 △X%, 전년비 △Y%) 감소",
    "▪ 경기동행지수(순환변동치) 상승(X p), 선행지수(순환변동치) 하락(△Y p)",
  ].join("\n");

  const lines = input.items.map(
    (item) => `- ${item.name} ${item.comparison}: ${formatItem(item)} (방향: ${directionWord(item)})`,
  );
  const user = [`기준 달: ${year}년 ${month}월`, "사용할 수치:", ...lines].join("\n");
  return { system, user };
}

/** 초안에 써도 되는 숫자의 글자들. 보낸 수치의 크기와 기준 달의 숫자만 허용한다. */
export function allowedNumbers(input: SummaryInput): Set<string> {
  const { year, short, month } = periodParts(input.period);
  // "ʼ26.8월"처럼 연·월이 소수점처럼 붙어 있는 표기도 허용한다.
  const allowed = new Set<string>([year, short, month, month.padStart(2, "0"), `${short}.${month}`]);
  for (const item of input.items) {
    const magnitude = Math.abs(item.value);
    allowed.add(magnitude.toFixed(1));
    if (Number.isInteger(magnitude)) allowed.add(String(magnitude));
  }
  return allowed;
}

/** 글에 적힌 숫자 중 허용 목록에 없는 것을 찾는다. 없으면 빈 목록이다. */
export function findUnsupportedNumbers(text: string, allowed: ReadonlySet<string>): string[] {
  const found = text.match(/\d+(?:\.\d+)?/g) ?? [];
  return [...new Set(found.filter((token) => !allowed.has(token)))];
}

/** 복사한 글 맨 위에 붙는 표시. 한글 문서에 붙여 넣은 뒤에도 확정본으로 착각하지 않게 한다. */
export const DRAFT_MARK = "[초안 — 담당자 확인 전]";

/** 복사할 글을 만든다. 앞뒤 빈 줄을 정리하고 맨 위에 초안 표시 한 줄을 붙인다. */
export function withDraftMark(text: string): string {
  return `${DRAFT_MARK}\n${text.trim()}`;
}
