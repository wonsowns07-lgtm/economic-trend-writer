import { describe, expect, it } from "vitest";
import type { ExtractedIndicator, Indicator } from "./indicators";
import { buildTable, rowKey } from "./table";
import { selectPassed, summarize, verifyTable } from "./verify";

const where = { page: 6, table: "전산업생산" };

function extracted(name: Indicator["name"], rawText: string, value: number): ExtractedIndicator {
  return {
    name,
    period: "2026-08",
    comparison: "전월비",
    unit: "%",
    source: where,
    indexes: null,
    value,
    status: "추출됨",
    rawText,
  };
}

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

const production = extracted("전산업생산", "-1.3", -1.3);
const retail = extracted("소매판매", "-1.8", -1.8);
const originals = [production, retail, blank];

function verify(texts: Record<string, string>) {
  const table = buildTable(originals, texts);
  return verifyTable(originals, table.indicators, table.errors);
}

describe("verifyTable", () => {
  it("아무것도 고치지 않으면 추출된 줄은 통과, 빈칸은 검증 불가다", () => {
    const items = verify({});
    expect(items.map((i) => i.result.status)).toEqual(["통과", "통과", "검증 불가"]);
    expect(items[0].result.message).toContain("-1.3");
    expect(items[2].result.message).toContain("비어 있습니다");
  });

  it("추출된 값을 다른 숫자로 고치면 오류이고 원자료 글자와 원자료 위치가 함께 나온다", () => {
    const items = verify({ [rowKey(production)]: "-1.4" });
    const item = items[0];
    expect(item.result.status).toBe("오류");
    expect(item.result.message).toContain("-1.3");
    expect(item.result.message).toContain("1.4");
    expect(item.result.source).toEqual(where);
  });

  it("같은 값을 다른 표기(△)로 적으면 통과다", () => {
    expect(verify({ [rowKey(production)]: "△1.3" })[0].result.status).toBe("통과");
  });

  it("빈칸에 직접 입력하면 원자료 글자가 없어 검증 불가다", () => {
    const item = verify({ [rowKey(blank)]: "-9.5" })[2];
    expect(item.result.status).toBe("검증 불가");
    expect(item.result.message).toContain("직접 입력");
  });

  it("숫자로 읽을 수 없는 입력은 오류다", () => {
    const item = verify({ [rowKey(retail)]: "abc" })[1];
    expect(item.result.status).toBe("오류");
    expect(item.result.message).toContain("숫자로 읽을 수 없어");
  });

  it("추출된 칸을 비우면 검증 불가다", () => {
    expect(verify({ [rowKey(retail)]: "" })[1].result.status).toBe("검증 불가");
  });
});

describe("지수가 있는 줄의 증감률 다시 계산", () => {
  const withIndexes: ExtractedIndicator = { ...production, indexes: { current: 98.7, base: 100 } };

  it("계산값과 맞으면 비교 한 건이 더 생기고 통과다", () => {
    const items = verifyTable([withIndexes], [withIndexes]);
    expect(items.map((i) => i.check)).toEqual(["원자료와 비교", "증감률 다시 계산"]);
    expect(items[1].result.status).toBe("통과");
  });

  it("0.1%p를 넘게 다르면 오류다", () => {
    const wrong: Indicator = { ...withIndexes, value: -1.9, rawText: "-1.9" };
    const items = verifyTable([wrong], [wrong]);
    expect(items[1].result.status).toBe("오류");
    expect(items[1].result.message).toContain("허용 범위");
  });

  it("지수가 없으면 다시 계산하지 않는다", () => {
    expect(verify({}).filter((i) => i.check === "증감률 다시 계산")).toHaveLength(0);
  });
});

describe("summarize", () => {
  it("상태별 건수를 센다", () => {
    const items = verify({ [rowKey(production)]: "-1.4" });
    expect(summarize(items)).toEqual({ 통과: 1, 오류: 1, "검증 불가": 1 });
  });
});

describe("selectPassed (초안에 쓸 수치)", () => {
  function passedNames(texts: Record<string, string>) {
    const table = buildTable(originals, texts);
    const items = verifyTable(originals, table.indicators, table.errors);
    return selectPassed(table.indicators, items).map((i) => i.name);
  }

  it("아무것도 고치지 않으면 추출된 줄만 쓴다 (빈칸은 뺀다)", () => {
    expect(passedNames({})).toEqual(["전산업생산", "소매판매"]);
  });

  it("값을 고쳐 오류가 된 줄은 뺀다", () => {
    expect(passedNames({ [rowKey(retail)]: "-1.9" })).toEqual(["전산업생산"]);
  });

  it("직접 입력한 값은 원자료와 비교할 수 없으므로 뺀다", () => {
    expect(passedNames({ [rowKey(blank)]: "-9.5" })).toEqual(["전산업생산", "소매판매"]);
  });

  it("숫자로 읽을 수 없는 입력이 있는 줄은 뺀다", () => {
    expect(passedNames({ [rowKey(production)]: "abc" })).toEqual(["소매판매"]);
  });

  it("증감률을 다시 계산해 맞지 않는 줄은 뺀다", () => {
    const bad: ExtractedIndicator = { ...production, indexes: { current: 90, base: 100 } };
    const items = verifyTable([bad], [bad]);
    expect(selectPassed([bad], items)).toEqual([]);
  });
});
