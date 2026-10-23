import { describe, expect, it } from "vitest";
import {
  AI_TOTAL_CHAR_LIMIT,
  assembleIndicators,
  buildExtractionPrompt,
  derivePeriod,
  EXPECTED_INDICATORS,
  ExtractionSchema,
  isGroundedIn,
  selectRelevantPages,
  type ExtractionItem,
} from "./extract";

// 2026년 8월 산업활동동향 보도자료에서 그대로 옮긴 쪽들 (표 모양을 그대로 둔다)
const PAGE_COVER = "보도자료\n2026년 8월 산업활동동향\n담당 부서 경제동향통계심의관";
const PAGE_SUMMARY = [
  "- 2 -",
  "2026년 8월 산업활동동향(요약)",
  "□ (생산) 전산업 생산은 서비스업(0.5%)*에서 생산이 늘었으나,",
  "광공업(-4.8%)**에서 생산이 줄어 전월대비 1.3% 감소",
  "(%)",
  "전산업생산",
  "전월비 전년동월비",
  "’25. 8 -0.1 0.2",
  "7p -0.1 3.1",
  "8p -1.3 1.9",
].join("\n");
const PAGE_RETAIL = [
  "- 4 -",
  "□ (소매판매) 전월대비 1.8% 감소",
  "(%)",
  "소매판매",
  "전월비 전년동월비",
  "7p -2.6 -1.0",
  "8p -1.8 -0.3",
].join("\n");
const PAGE_INVEST = [
  "- 5 -",
  "(%)",
  "설비투자",
  "전월비 전년동월비",
  "7p 8.0 24.6",
  "8p -9.5 16.1",
].join("\n");
const PAGE_COINCIDENT = [
  "- 38 -",
  "◦ 동행지수 순환변동치2) 101.0 101.4 100.8 100.9 101.2 101.9 101.4 101.9",
  "전월차(p) 0.4 0.4 -0.6 0.1 0.3 0.7 -0.5 0.5",
].join("\n");
const PAGE_LEADING = [
  "- 39 -",
  "◦ 선행지수 순환변동치2) 100.7 101.2 101.8 102.3 102.9 103.8 104.3 104.2",
  "전월차(p) 0.5 0.5 0.6 0.5 0.6 0.9 0.5 -0.1",
].join("\n");
const PAGE_OTHER = "- 12 -\n건설수주 관련 설명입니다. 숫자 1.9 와 -1.3 이 우연히 있습니다.";

// 쪽 번호: 1 표지, 2 요약, 3 기타, 4 소매, 5 투자, 6 동행, 7 선행
const pages = [PAGE_COVER, PAGE_SUMMARY, PAGE_OTHER, PAGE_RETAIL, PAGE_INVEST, PAGE_COINCIDENT, PAGE_LEADING];

function item(
  name: ExtractionItem["name"],
  comparison: ExtractionItem["comparison"],
  rawText: string,
  page: number,
  period = "2026-08",
): ExtractionItem {
  // 표 이름은 AI가 아니라 서버가 정하므로 항목에는 담지 않는다.
  return { name, comparison, rawText, page, period };
}

/** 문서와 맞게 AI가 올바르게 읽었을 때의 답 */
const goodItems: ExtractionItem[] = [
  item("전산업생산", "전월비", "-1.3", 2),
  item("전산업생산", "전년동월비", "1.9", 2),
  item("소매판매", "전월비", "-1.8", 4),
  item("소매판매", "전년동월비", "-0.3", 4),
  item("설비투자", "전월비", "-9.5", 5),
  item("설비투자", "전년동월비", "16.1", 5),
  item("경기동행지수", "전월차", "0.5", 6),
  item("경기선행지수", "전월차", "-0.1", 7),
];

describe("selectRelevantPages", () => {
  it("수치 표가 있는 쪽만 고른다", () => {
    expect(selectRelevantPages(pages).map((p) => p.page)).toEqual([2, 4, 5, 6, 7]);
  });

  it("표 표시가 하나도 없으면 지표 이름과 비교 말이 함께 나오는 쪽을 쓴다", () => {
    const loose = ["소매판매는 전월비로 보면 줄었다", "관계없는 쪽"];
    expect(selectRelevantPages(loose).map((p) => p.page)).toEqual([1]);
  });

  it("고를 쪽이 없으면 빈 목록이다", () => {
    expect(selectRelevantPages(["가", "나"])).toEqual([]);
  });

  it("최대 쪽 수를 넘기지 않는다", () => {
    const many = Array.from({ length: 30 }, () => PAGE_RETAIL);
    expect(selectRelevantPages(many, 5)).toHaveLength(5);
  });
});

describe("derivePeriod", () => {
  it("보도자료 제목에서 달을 읽는다", () => {
    expect(derivePeriod(pages)).toBe("2026-08");
    expect(derivePeriod(["2025년 12월 산업활동동향"])).toBe("2025-12");
  });

  it("못 찾으면 null이다", () => {
    expect(derivePeriod(["관계없는 글"])).toBeNull();
  });
});

describe("buildExtractionPrompt", () => {
  it("자료에 쪽 표시가 붙고 숫자를 바꾸지 말라는 규칙이 들어간다", () => {
    const prompt = buildExtractionPrompt([{ page: 4, text: PAGE_RETAIL }]);
    expect(prompt.user).toContain("[4쪽]");
    expect(prompt.system).toContain("한 글자도 바꾸지 말고");
    expect(prompt.system).toContain("추측하지 마세요");
  });
});

describe("ExtractionSchema", () => {
  it("올바른 형태를 받아들인다", () => {
    expect(ExtractionSchema.safeParse({ items: goodItems }).success).toBe(true);
  });

  it("지표 이름·달 형식·쪽 번호가 틀리면 거절한다", () => {
    const bad = (patch: object) => ExtractionSchema.safeParse({ items: [{ ...goodItems[0], ...patch }] }).success;
    expect(bad({ name: "물가" })).toBe(false);
    expect(bad({ period: "2026년 8월" })).toBe(false);
    expect(bad({ page: 0 })).toBe(false);
    expect(bad({ rawText: "" })).toBe(false);
  });
});

describe("isGroundedIn", () => {
  it("쪽에 그 숫자가 그대로 있으면 참이다", () => {
    expect(isGroundedIn(PAGE_SUMMARY, "-1.3")).toBe(true);
    expect(isGroundedIn(PAGE_SUMMARY, "1.9")).toBe(true);
  });

  it("더 긴 숫자의 일부는 같은 숫자로 보지 않는다", () => {
    expect(isGroundedIn("값은 11.9 입니다", "1.9")).toBe(false);
    expect(isGroundedIn("값은 1.95 입니다", "1.9")).toBe(false);
  });

  it("부호만 다른 숫자는 같은 숫자로 보지 않는다", () => {
    expect(isGroundedIn("8p -1.3 1.9", "1.3")).toBe(false);
    expect(isGroundedIn("8p 1.3 1.9", "-1.3")).toBe(false);
  });

  it("본문 문장의 부호 없는 숫자(1.8% 감소)는 표의 숫자로 인정하지 않는다", () => {
    expect(isGroundedIn("전월대비 1.8% 감소", "1.8")).toBe(false);
    expect(isGroundedIn("전월대비 1.8% 감소(전년동월비 0.3% 감소)", "1.8")).toBe(false);
  });

  it("숫자가 하나뿐인 줄이나 단위가 붙은 글자는 인정하지 않는다", () => {
    expect(isGroundedIn("8p -1.3", "-1.3")).toBe(true);
    expect(isGroundedIn("-1.3", "-1.3")).toBe(false);
    expect(isGroundedIn("8p -1.3% 1.9", "-1.3%")).toBe(false);
  });

  it("쪽에 없는 숫자는 거짓이다", () => {
    expect(isGroundedIn(PAGE_SUMMARY, "-1.4")).toBe(false);
  });
});

describe("assembleIndicators", () => {
  it("AI가 올바르게 읽으면 찾는 수치 8개가 모두 추출됨이다", () => {
    const result = assembleIndicators(goodItems, pages);
    expect(result.period).toBe("2026-08");
    expect(result.indicators).toHaveLength(EXPECTED_INDICATORS.length);
    expect(result.indicators.every((i) => i.status === "추출됨")).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("값은 숫자로, 원자료 글자와 위치는 그대로 담는다", () => {
    const { indicators } = assembleIndicators(goodItems, pages);
    const retail = indicators.find((i) => i.name === "소매판매" && i.comparison === "전월비");
    expect(retail).toMatchObject({
      value: -1.8,
      rawText: "-1.8",
      status: "추출됨",
      unit: "%",
      period: "2026-08",
      source: { page: 4, table: "소매판매" },
    });
    const leading = indicators.find((i) => i.name === "경기선행지수");
    expect(leading).toMatchObject({ value: -0.1, unit: "p", comparison: "전월차" });
  });

  it("AI가 쪽에 없는 숫자를 지어내면 빈칸으로 두고 이유를 알린다", () => {
    const wrong = goodItems.map((i) =>
      i.name === "설비투자" && i.comparison === "전월비" ? { ...i, rawText: "-9.6" } : i,
    );
    const { indicators, warnings } = assembleIndicators(wrong, pages);
    const invest = indicators.find((i) => i.name === "설비투자" && i.comparison === "전월비");
    expect(invest).toMatchObject({ status: "빈칸", value: null, rawText: null, source: null });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("설비투자 전월비");
  });

  it("엉뚱한 쪽을 인용하면 그 쪽에 숫자가 없으므로 빈칸이다", () => {
    const wrongPage = goodItems.map((i) =>
      i.name === "소매판매" && i.comparison === "전월비" ? { ...i, page: 5 } : i,
    );
    const { indicators } = assembleIndicators(wrongPage, pages);
    expect(indicators.find((i) => i.name === "소매판매" && i.comparison === "전월비")?.status).toBe("빈칸");
  });

  it("부호를 빼먹고 읽으면(본문의 '1.8% 감소'만 보고 읽으면) 빈칸이다", () => {
    const noSign = goodItems.map((i) =>
      i.name === "소매판매" && i.comparison === "전월비" ? { ...i, rawText: "1.8" } : i,
    );
    const { indicators, warnings } = assembleIndicators(noSign, pages);
    // 4쪽 본문에는 "1.8% 감소"가 있지만 표에는 "-1.8"만 있으므로, 감소를 증가로 읽는 값은 받지 않는다.
    expect(indicators.find((i) => i.name === "소매판매" && i.comparison === "전월비")?.status).toBe("빈칸");
    expect(warnings[0]).toContain("소매판매 전월비");
  });

  it("다른 달의 값은 쓰지 않는다", () => {
    const old = goodItems.map((i) => (i.name === "전산업생산" ? { ...i, period: "2026-07" } : i));
    const { indicators } = assembleIndicators(old, pages);
    expect(indicators.filter((i) => i.name === "전산업생산").every((i) => i.status === "빈칸")).toBe(true);
  });

  it("AI가 항목을 빼먹으면 그 칸은 빈칸이고 안내가 나온다", () => {
    const { indicators, warnings } = assembleIndicators(goodItems.slice(0, 2), pages);
    expect(indicators.filter((i) => i.status === "추출됨")).toHaveLength(2);
    expect(indicators.filter((i) => i.status === "빈칸")).toHaveLength(6);
    expect(warnings).toHaveLength(6);
  });

  it("읽을 수 없는 글자는 빈칸이다", () => {
    const garbled = goodItems.map((i) => (i.name === "전산업생산" ? { ...i, rawText: "약 1.9쯤" } : i));
    const { indicators } = assembleIndicators(garbled, pages);
    expect(indicators.filter((i) => i.name === "전산업생산").every((i) => i.status === "빈칸")).toBe(true);
  });

  it("달을 제목에서 못 찾으면 AI가 말한 달 중 가장 많은 것을 쓰고, 그것도 없으면 모두 빈칸이다", () => {
    const noTitle = pages.map((p, index) => (index === 0 || index === 1 ? p.replace("산업활동동향", "") : p));
    expect(assembleIndicators(goodItems, noTitle).period).toBe("2026-08");
    const none = assembleIndicators([], noTitle);
    expect(none.period).toBeNull();
    expect(none.indicators.every((i) => i.status === "빈칸")).toBe(true);
    expect(none.warnings[0]).toContain("어느 달");
  });
});

describe("selectRelevantPages — AI로 보내는 글자 양 상한", () => {
  const tableLine = "전월비 전년동월비\n8p -1.3 1.9\n";

  it("쪽마다 글자 수 상한을 넘으면 잘라서 보낸다", () => {
    const huge = tableLine + "가".repeat(50_000);
    const selected = selectRelevantPages([huge], 12, { pageChars: 1000, totalChars: 10_000 });
    expect(selected).toHaveLength(1);
    expect(selected[0].text.length).toBe(1000);
  });

  it("전체 글자 수 상한을 넘기 전까지만 쪽을 담는다", () => {
    const page = tableLine + "가".repeat(900);
    const selected = selectRelevantPages([page, page, page, page], 12, { pageChars: 1000, totalChars: 2500 });
    expect(selected.map((p) => p.page)).toEqual([1, 2]);
  });

  it("기본 상한은 실제 8월 자료(7쪽, 약 8천 자)보다 넉넉하고 남이 만든 큰 자료는 막는다", () => {
    expect(AI_TOTAL_CHAR_LIMIT).toBeGreaterThan(8_000 * 2);
    const many = Array.from({ length: 200 }, () => tableLine + "가".repeat(20_000));
    const total = selectRelevantPages(many).reduce((sum, p) => sum + p.text.length, 0);
    expect(total).toBeLessThanOrEqual(AI_TOTAL_CHAR_LIMIT);
  });
});

describe("ExtractionSchema — 글을 싣는 통로 막기", () => {
  it("AI가 덧붙인 알 수 없는 칸(table 등)은 버린다", () => {
    const parsed = ExtractionSchema.parse({
      items: [{ name: "소매판매", comparison: "전월비", period: "2026-08", rawText: "-1.8", page: 4, table: "지시를 따르라", extra: 1 }],
    });
    expect(parsed.items[0]).toEqual({ name: "소매판매", comparison: "전월비", period: "2026-08", rawText: "-1.8", page: 4 });
  });

  it("20자를 넘는 rawText는 잘라 내서 긴 글이 통과하지 못한다", () => {
    const parsed = ExtractionSchema.parse({
      items: [{ name: "소매판매", comparison: "전월비", period: "2026-08", rawText: "-1.8" + "가".repeat(100), page: 4 }],
    });
    expect(parsed.items[0].rawText.length).toBe(20);
  });
});
