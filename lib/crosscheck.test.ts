import { describe, expect, it } from "vitest";
import fixture from "./fixtures/indicators-2026-08.json";
import { crossCheck, readSources } from "./crosscheck";
import { roundToTenth } from "./growth";
import type { Comparison, IndicatorName } from "./indicators";

// 실제 2026년 8월 산업활동동향 보도자료(공개자료)에서 수치가 있는 쪽의 글자만 옮겨 둔 것이다.
const pages: string[] = fixture;

// 문서에 실제로 적힌 값
const TRUTH: ReadonlyArray<[IndicatorName, Comparison, number]> = [
  ["전산업생산", "전월비", -1.3],
  ["전산업생산", "전년동월비", 1.9],
  ["소매판매", "전월비", -1.8],
  ["소매판매", "전년동월비", -0.3],
  ["설비투자", "전월비", -9.5],
  ["설비투자", "전년동월비", 16.1],
  ["경기동행지수", "전월차", 0.5],
  ["경기선행지수", "전월차", -0.1],
];

describe("readSources — AI 없이 규칙으로 읽기", () => {
  const readings = readSources(pages, "2026-08");

  it("8개 수치를 모두 문서에서 찾고, 값이 실제 문서와 같다", () => {
    for (const [name, comparison, value] of TRUTH) {
      const found = readings[`${name}|${comparison}`] ?? [];
      expect(found.length, `${name} ${comparison}`).toBeGreaterThanOrEqual(2);
      for (const reading of found) expect(reading.value, `${name} ${comparison} ${reading.where}`).toBe(value);
    }
  });

  it("서로 다른 곳(표·주요지표 표·본문)에서 읽는다", () => {
    const where = (readings["전산업생산|전월비"] ?? []).map((r) => r.where).join(" ");
    expect(where).toContain("전산업생산 표");
    expect(where).toContain("주요지표");
    expect(where).toContain("본문");
  });

  it("기준 달이 다르면 표의 다른 달 숫자를 가져오지 않는다", () => {
    expect(readSources(pages, "2026-07")).toEqual({});
    expect(readSources(pages, null)).toEqual({});
  });
});

describe("crossCheck", () => {
  const readings = readSources(pages, "2026-08");

  it("문서와 같은 값은 교차 확인이다", () => {
    for (const [name, comparison, value] of TRUTH) {
      const result = crossCheck(name, comparison, value, readings);
      expect(result.status, `${name} ${comparison}`).toBe("교차 확인");
      expect(result.agree).toBe(result.total);
    }
  });

  it("문서에서 찾을 수 없는 값(지어낸 지표)은 확인 못 함이다", () => {
    expect(crossCheck("전산업생산", "전월차", 1.0, readings).status).toBe("확인 못 함");
    expect(crossCheck("소매판매", "전월비", -1.8, {}).status).toBe("확인 못 함");
  });

  it("값이 비어 있으면 문서에 적힌 값을 알려 준다", () => {
    const result = crossCheck("설비투자", "전월비", null, readings);
    expect(result.status).toBe("확인 못 함");
    expect(result.detail).toContain("-9.5");
  });
});

describe("환각 탐지율 — AI가 틀린 값을 냈다고 가정", () => {
  const readings = readSources(pages, "2026-08");

  // 환각·착각이 나타나는 모양들
  const MISTAKES: ReadonlyArray<{ label: string; wrong: (truth: number) => number | null }> = [
    { label: "부호가 뒤집힘", wrong: (v) => (v === 0 ? null : -v) },
    { label: "끝자리 0.1 차이", wrong: (v) => roundToTenth(v + 0.1) },
    { label: "끝자리 0.1 반대 차이", wrong: (v) => roundToTenth(v - 0.1) },
    { label: "소수점 위치가 틀림", wrong: (v) => roundToTenth(v * 10) },
    { label: "숫자가 통째로 지어내짐", wrong: (v) => roundToTenth(v + 3.7) },
    { label: "0으로 채움", wrong: (v) => (v === 0 ? null : 0) },
  ];

  it("틀린 값은 모두 불일치로 잡는다", () => {
    let total = 0;
    const missed: string[] = [];
    for (const [name, comparison, truth] of TRUTH) {
      for (const mistake of MISTAKES) {
        const wrong = mistake.wrong(truth);
        if (wrong === null || wrong === truth) continue;
        total += 1;
        if (crossCheck(name, comparison, wrong, readings).status !== "불일치") missed.push(`${name} ${comparison} ${mistake.label} ${wrong}`);
      }
    }
    expect(total).toBeGreaterThan(40);
    expect(missed).toEqual([]);
  });

  it("지난달 표 숫자를 가져온 착각도 잡는다 (같은 표의 7월·6월 값)", () => {
    // 전산업생산 전월비: 7월 -0.1, 6월 2.6 / 소매판매 전월비: 7월 -2.6 / 설비투자 전월비: 7월 8.0
    expect(crossCheck("전산업생산", "전월비", -0.1, readings).status).toBe("불일치");
    expect(crossCheck("전산업생산", "전월비", 2.6, readings).status).toBe("불일치");
    expect(crossCheck("소매판매", "전월비", -2.6, readings).status).toBe("불일치");
    expect(crossCheck("설비투자", "전월비", 8.0, readings).status).toBe("불일치");
  });

  it("전월비와 전년동월비를 서로 바꿔 읽은 착각도 잡는다", () => {
    expect(crossCheck("전산업생산", "전월비", 1.9, readings).status).toBe("불일치");
    expect(crossCheck("전산업생산", "전년동월비", -1.3, readings).status).toBe("불일치");
    expect(crossCheck("설비투자", "전월비", 16.1, readings).status).toBe("불일치");
  });
});
