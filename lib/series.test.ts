import { describe, expect, it } from "vitest";
import fixture from "./fixtures/indicators-2026-08.json";
import { readSeries } from "./series";

// 실제 2026년 8월 산업활동동향 보도자료(공개자료)에서 수치가 있는 쪽의 글자만 옮겨 둔 것이다.
const pages: string[] = fixture;

describe("readSeries", () => {
  const series = readSeries(pages, "2026-08");
  const get = (name: string) => series.find((s) => s.name === name);

  it("다섯 지표의 월별 흐름을 문서에 적힌 대로 읽는다", () => {
    expect(series.map((s) => s.name)).toEqual(["전산업생산", "소매판매", "설비투자", "경기동행지수", "경기선행지수"]);
    const production = get("전산업생산");
    expect(production?.labels).toEqual(["’25.8", "’26.5", "6월", "7월", "8월"]);
    expect(production?.primary).toEqual([-0.1, -0.4, 2.6, -0.1, -1.3]);
    expect(production?.secondary).toEqual([0.2, 1.9, 4.5, 3.1, 1.9]);
    expect(get("소매판매")?.primary).toEqual([-2.2, -0.1, 2.7, -2.6, -1.8]);
    expect(get("설비투자")?.secondary).toEqual([-2.5, 9.3, 21.6, 24.6, 16.1]);
  });

  it("경기지수는 전월차(p) 다섯 달을 읽는다", () => {
    expect(get("경기동행지수")?.primary).toEqual([0.2, -0.4, 0.5, 0.8, 0.5]);
    expect(get("경기선행지수")?.primary).toEqual([0.5, 0.6, 0.9, 0.5, -0.1]);
    expect(get("경기동행지수")?.labels).toEqual(["’26.4", "5월", "6월", "7월", "8월"]);
  });

  it("맨 오른쪽 달이 기준 달과 다르면 그리지 않는다", () => {
    expect(readSeries(pages, "2026-07")).toEqual([]);
    expect(readSeries(pages, null)).toEqual([]);
  });
});
