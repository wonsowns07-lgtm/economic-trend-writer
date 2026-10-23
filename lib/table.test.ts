import { describe, expect, it } from "vitest";
import type { Indicator } from "./indicators";
import { applyEdit, blankTable, buildTable, formatPeriod, formatSource, initialText, rowKey } from "./table";

const where = { page: 6, table: "전산업생산" };

const extracted: Indicator = {
  name: "전산업생산",
  period: "2026-08",
  comparison: "전월비",
  unit: "%",
  source: where,
  indexes: null,
  value: -1.3,
  status: "추출됨",
  rawText: "-1.3",
};

const blank: Indicator = {
  name: "설비투자",
  period: "2026-08",
  comparison: "전월비",
  unit: "%",
  source: null,
  indexes: null,
  value: null,
  status: "빈칸",
  rawText: null,
};

describe("initialText", () => {
  it("추출된 값은 원자료 글자를, 빈칸은 빈 글자를 보여 준다", () => {
    expect(initialText(extracted)).toBe("-1.3");
    expect(initialText(blank)).toBe("");
  });
});

describe("applyEdit", () => {
  it("빈칸에 숫자를 적으면 직접 입력이 된다", () => {
    const { indicator, error } = applyEdit(blank, "△9.5");
    expect(error).toBeNull();
    expect(indicator).toMatchObject({ status: "직접 입력", value: -9.5, rawText: null });
  });

  it("△, -, 단위가 붙은 글자도 같은 값으로 읽는다", () => {
    for (const text of ["△9.5", "-9.5", "−9.5", "△ 9.5%", " -9.5 "]) {
      expect(applyEdit(blank, text).indicator.value, text).toBe(-9.5);
    }
  });

  it("추출된 값을 다른 숫자로 고치면 직접 입력이 되고 원자료 위치는 남는다", () => {
    const { indicator } = applyEdit(extracted, "-1.4");
    expect(indicator).toMatchObject({ status: "직접 입력", value: -1.4, rawText: null, source: where });
  });

  it("추출된 값과 같은 숫자를 다시 적으면 추출됨 그대로다", () => {
    expect(applyEdit(extracted, "△1.3").indicator).toBe(extracted);
    expect(applyEdit(extracted, "-1.3").indicator).toBe(extracted);
  });

  it("칸을 비우면 빈칸이 된다", () => {
    const { indicator, error } = applyEdit(extracted, "   ");
    expect(error).toBeNull();
    expect(indicator).toMatchObject({ status: "빈칸", value: null, rawText: null });
  });

  it("숫자로 읽을 수 없으면 원래 줄을 그대로 두고 안내를 돌려준다", () => {
    for (const text of ["abc", "▲1.3", "1.2.3", "많음"]) {
      const result = applyEdit(extracted, text);
      expect(result.indicator, text).toBe(extracted);
      expect(result.error, text).toContain("숫자로 읽을 수 없습니다");
    }
  });
});

describe("buildTable", () => {
  it("입력이 없는 줄은 그대로 두고, 고친 줄만 반영한다", () => {
    const table = buildTable([extracted, blank], { [rowKey(blank)]: "-9.5" });
    expect(table.indicators[0]).toBe(extracted);
    expect(table.indicators[1]).toMatchObject({ status: "직접 입력", value: -9.5 });
    expect(table.errors).toEqual({});
  });

  it("잘못 입력한 줄은 오류에 담고 값은 원래대로 둔다", () => {
    const table = buildTable([extracted, blank], { [rowKey(blank)]: "abc" });
    expect(table.indicators[1]).toBe(blank);
    expect(Object.keys(table.errors)).toEqual([rowKey(blank)]);
  });
});

describe("보여 주기용 글자", () => {
  it("달을 '2026년 8월'로 바꾼다", () => {
    expect(formatPeriod("2026-08")).toBe("2026년 8월");
    expect(formatPeriod("2025-12")).toBe("2025년 12월");
    expect(formatPeriod("이상한 값")).toBe("이상한 값");
  });

  it("원자료 위치를 쪽과 표 이름으로 보여 주고 없으면 줄표다", () => {
    expect(formatSource(where)).toBe("6쪽 · 전산업생산");
    expect(formatSource(null)).toBe("—");
  });
});

describe("blankTable (추출 실패 때 여는 빈 표)", () => {
  it("찾는 수치 8줄이 모두 빈칸이다", () => {
    const rows = blankTable("2026-08");
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.status === "빈칸" && r.value === null && r.rawText === null)).toBe(true);
    expect(rows.every((r) => r.period === "2026-08")).toBe(true);
  });

  it("줄마다 열쇠가 달라 입력칸이 겹치지 않는다", () => {
    const keys = blankTable(null).map(rowKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("달을 모르면 빈 글자로 둔다", () => {
    expect(blankTable(null).every((r) => r.period === "")).toBe(true);
  });

  it("빈 표에 값을 적으면 직접 입력이 되어 바로 쓸 수 있다", () => {
    const rows = blankTable("2026-08");
    const table = buildTable(rows, { [rowKey(rows[0])]: "-1.3" });
    expect(table.indicators[0]).toMatchObject({ status: "직접 입력", value: -1.3 });
    expect(table.errors).toEqual({});
  });
});
