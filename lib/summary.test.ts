import { describe, expect, it } from "vitest";
import {
  allowedNumbers,
  buildSummaryPrompt,
  DRAFT_MARK,
  directionWord,
  findUnsupportedNumbers,
  formatItem,
  SummaryInputSchema,
  type SummaryInput,
  withDraftMark,
} from "./summary";

const input: SummaryInput = {
  period: "2026-08",
  items: [
    { name: "전산업생산", comparison: "전월비", unit: "%", value: -1.3 },
    { name: "전산업생산", comparison: "전년동월비", unit: "%", value: 1.9 },
    { name: "경기동행지수", comparison: "전월차", unit: "p", value: 0.5 },
    { name: "경기선행지수", comparison: "전월차", unit: "p", value: -0.1 },
  ],
};

describe("directionWord / formatItem", () => {
  it("부호로 방향을 정한다. 경기지수 전월차는 상승·하락이다", () => {
    expect(directionWord({ comparison: "전월비", value: -1.3 })).toBe("감소");
    expect(directionWord({ comparison: "전년동월비", value: 1.9 })).toBe("증가");
    expect(directionWord({ comparison: "전월차", value: 0.5 })).toBe("상승");
    expect(directionWord({ comparison: "전월차", value: -0.1 })).toBe("하락");
    expect(directionWord({ comparison: "전월비", value: 0 })).toBe("보합");
  });

  it("감소는 △, 단위를 붙여 적는다", () => {
    expect(formatItem({ unit: "%", value: -1.3 })).toBe("△1.3%");
    expect(formatItem({ unit: "p", value: -0.1 })).toBe("△0.1p");
    expect(formatItem({ unit: "%", value: 1.9 })).toBe("1.9%");
    expect(formatItem({ unit: "지수", value: 101.3 })).toBe("101.3");
  });
});

describe("SummaryInputSchema", () => {
  it("올바른 형태를 받아들인다", () => {
    expect(SummaryInputSchema.safeParse(input).success).toBe(true);
  });

  it("달 형식, 지표 이름, 값, 개수가 틀리면 거절한다", () => {
    const bad = (patch: object) => SummaryInputSchema.safeParse({ ...input, ...patch }).success;
    expect(bad({ period: "2026년 8월" })).toBe(false);
    expect(bad({ items: [] })).toBe(false);
    expect(bad({ items: [{ ...input.items[0], name: "물가" }] })).toBe(false);
    expect(bad({ items: [{ ...input.items[0], value: Number.NaN }] })).toBe(false);
    expect(bad({ items: Array(21).fill(input.items[0]) })).toBe(false);
  });
});

describe("buildSummaryPrompt", () => {
  const prompt = buildSummaryPrompt(input);

  it("수치를 미리 표기하고 방향을 코드가 정해서 준다", () => {
    expect(prompt.user).toContain("전산업생산 전월비: △1.3% (방향: 감소)");
    expect(prompt.user).toContain("전산업생산 전년동월비: 1.9% (방향: 증가)");
    expect(prompt.user).toContain("경기선행지수 전월차: △0.1p (방향: 하락)");
    expect(prompt.user).toContain("기준 달: 2026년 8월");
  });

  it("숫자를 바꾸지 말고 원인·전망·다른 통계를 쓰지 말라는 규칙이 들어간다", () => {
    expect(prompt.system).toContain("한 글자도 바꾸지 말고");
    expect(prompt.system).toContain("단정하지 마세요");
    expect(prompt.system).toContain("수출·고용·물가");
  });

  it("형식 예시에는 실제 숫자 대신 자리표시자를 쓴다", () => {
    expect(prompt.system).toContain("△X%");
    expect(prompt.system).not.toMatch(/△\d/);
  });
});

describe("allowedNumbers / findUnsupportedNumbers", () => {
  const allowed = allowedNumbers(input);

  it("보낸 수치의 크기와 기준 달의 숫자를 허용한다", () => {
    for (const token of ["1.3", "1.9", "0.5", "0.1", "2026", "26", "8", "26.8"]) {
      expect(allowed.has(token), token).toBe(true);
    }
  });

  it("보낸 수치만 쓴 글은 문제가 없다", () => {
    const text = [
      "ʼ26.8월 산업활동동향 주요지표는 전산업생산 감소",
      "▪ 생산은 전산업생산(전월비 △1.3%, 전년비 1.9%) 감소",
      "▪ 경기동행지수(순환변동치) 상승(0.5p), 선행지수(순환변동치) 하락(△0.1p)",
    ].join("\n");
    expect(findUnsupportedNumbers(text, allowed)).toEqual([]);
  });

  it("보내지 않은 숫자(다른 수치, 반올림, 새 숫자)는 찾아낸다", () => {
    expect(findUnsupportedNumbers("전산업생산 전월비 △1.4% 감소", allowed)).toEqual(["1.4"]);
    expect(findUnsupportedNumbers("약 2% 증가, 3분기 연속", allowed)).toEqual(["2", "3"]);
    expect(findUnsupportedNumbers("△1.3%와 1.3%, 1.3%", allowed)).toEqual([]);
  });

  it("숫자가 없는 글은 문제가 없다", () => {
    expect(findUnsupportedNumbers("생산이 줄었습니다", allowed)).toEqual([]);
  });
});

describe("withDraftMark", () => {
  it("맨 위에 초안 표시를 붙이고 앞뒤 빈 줄을 정리한다", () => {
    expect(withDraftMark("\n  ▪ 생산은 감소  \n\n")).toBe("[초안 — 담당자 확인 전]\n▪ 생산은 감소");
  });

  it("여러 줄 글의 줄바꿈은 그대로 둔다", () => {
    expect(withDraftMark("가\n나")).toBe(`${DRAFT_MARK}\n가\n나`);
  });
});
