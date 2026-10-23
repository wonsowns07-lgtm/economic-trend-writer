// Plan SC: PLAN 15번 작업 — "수치 오류: 원자료와 어긋난 수치를 모두 찾아낸다"를 재는 시험.
// 실제 2026년 8월 종합평가의 수치 6개를 일부러 틀리게 바꾼 작성본과 표 입력을 많이 만들어, 하나도 놓치지 않고 찾아내는지 센다.

import { describe, expect, it } from "vitest";
import { compareDraft } from "./compare";
import { formatSigned } from "./growth";
import type { Comparison, ExtractedIndicator, Indicator, IndicatorName } from "./indicators";
import { applyEdit, buildTable, rowKey } from "./table";
import { verifyTable } from "./verify";

interface Truth {
  name: IndicatorName;
  comparison: Comparison;
  value: number;
}

// 문서(2026년 8월 산업활동동향)에 실제로 적힌 값
const TRUTH: Truth[] = [
  { name: "전산업생산", comparison: "전월비", value: -1.3 },
  { name: "전산업생산", comparison: "전년동월비", value: 1.9 },
  { name: "소매판매", comparison: "전월비", value: -1.8 },
  { name: "소매판매", comparison: "전년동월비", value: -0.3 },
  { name: "설비투자", comparison: "전월비", value: -9.5 },
  { name: "설비투자", comparison: "전년동월비", value: 16.1 },
];

const round1 = (n: number) => Number(n.toFixed(1));

/** 한 수치를 틀리게 만드는 방법들. 각각 글자(작성본에 적힐 모양)를 돌려준다. */
const MUTATIONS: ReadonlyArray<{ label: string; mutate: (value: number) => string | null }> = [
  { label: "끝자리 +0.1", mutate: (v) => formatSigned(round1(v + 0.1), "%") },
  { label: "끝자리 -0.1", mutate: (v) => formatSigned(round1(v - 0.1), "%") },
  { label: "부호 뒤집기", mutate: (v) => formatSigned(-v, "%") },
  { label: "정수 자리 +1", mutate: (v) => formatSigned(round1(v + 1), "%") },
  { label: "정수 자리 -1", mutate: (v) => formatSigned(round1(v - 1), "%") },
  { label: "소수점 자리 이동", mutate: (v) => formatSigned(round1(v * 10), "%") },
  { label: "자릿수 하나 더(소수 둘째 자리)", mutate: (v) => `${formatSigned(v, "").replace(/%$/, "")}5%` },
  { label: "10배", mutate: (v) => formatSigned(round1(v * 10), "%") },
  { label: "10분의 1", mutate: (v) => formatSigned(round1(v / 10), "%") },
];

const label = (comparison: Comparison) => (comparison === "전월비" ? "전월비" : "전년비");

/** 작성본 문장을 만든다. mutatedIndex 줄만 mutatedText로 바꾸고 나머지는 올바른 값으로 쓴다. */
function draftWith(mutatedIndex: number, mutatedText: string): string {
  return TRUTH.map((t, i) => {
    const text = i === mutatedIndex ? mutatedText : formatSigned(t.value, "%");
    return `▪ ${t.name}(${label(t.comparison)} ${text}) 감소`;
  }).join("\n");
}

function originals(): ExtractedIndicator[] {
  return TRUTH.map((t) => ({
    name: t.name,
    period: "2026-08",
    comparison: t.comparison,
    unit: "%",
    source: { page: 6, table: t.name },
    indexes: null,
    value: t.value,
    status: "추출됨",
    rawText: String(t.value),
  }));
}

describe("작성본의 틀린 숫자 찾기 (오류 탐지율)", () => {
  it("올바른 작성본은 6개 모두 일치이고 불일치는 0개다 (오탐 없음)", () => {
    const report = compareDraft(draftWith(-1, ""), originals());
    // draftWith(-1, ...)는 어느 줄도 바꾸지 않는다
    expect(report.findings).toHaveLength(6);
    expect(report.findings.every((f) => f.status === "일치")).toBe(true);
  });

  it("일부러 틀리게 쓴 숫자를 하나도 놓치지 않고 불일치로 잡는다", () => {
    let total = 0;
    const missed: string[] = [];

    TRUTH.forEach((truth, index) => {
      for (const { label: how, mutate } of MUTATIONS) {
        const wrong = mutate(truth.value);
        if (wrong === null) continue;
        // 틀린 값이 우연히 원래 값과 같아지는 경우(예: 0의 부호 뒤집기)는 시험 대상이 아니다.
        const wrongValue = Number(wrong.replace("△", "-").replace("%", ""));
        if (wrongValue === truth.value) continue;

        total += 1;
        const findings = compareDraft(draftWith(index, wrong), originals()).findings;
        const mine = findings[index];
        const others = findings.filter((_, i) => i !== index);
        const detected = mine?.status === "불일치";
        const noFalseAlarm = others.every((f) => f.status === "일치");
        if (!detected || !noFalseAlarm) missed.push(`${truth.name} ${truth.comparison} ${how}: ${wrong}`);
      }
    });

    expect(total).toBeGreaterThanOrEqual(50);
    expect(missed).toEqual([]);
  });
});

describe("표에서 고친 숫자 찾기 (오류 탐지율)", () => {
  it("추출된 값을 다른 숫자로 고치면 모두 오류로 잡는다", () => {
    const rows = originals();
    let total = 0;
    const missed: string[] = [];

    rows.forEach((row, index) => {
      for (const { label: how, mutate } of MUTATIONS) {
        const wrong = mutate(row.value);
        if (wrong === null) continue;
        const result = applyEdit(row, wrong);
        // 입력을 읽을 수 없거나 같은 값이면 시험 대상이 아니다
        if (result.error || result.indicator.value === row.value) continue;

        total += 1;
        const table = buildTable(rows, { [rowKey(row)]: wrong });
        const items = verifyTable(rows, table.indicators, table.errors);
        const detected = items[index].result.status === "오류";
        const others = items.filter((_, i) => i !== index).every((item) => item.result.status === "통과");
        if (!detected || !others) missed.push(`${row.name} ${row.comparison} ${how}: ${wrong}`);
      }
    });

    expect(total).toBeGreaterThanOrEqual(50);
    expect(missed).toEqual([]);
  });

  it("표기만 다르고 값이 같으면(△1.3 ↔ -1.3) 오류로 잡지 않는다", () => {
    const rows: Indicator[] = originals();
    for (const row of rows) {
      const value = row.value as number;
      for (const text of [formatSigned(value), formatSigned(value, "%"), String(value)]) {
        const table = buildTable(rows, { [rowKey(row)]: text });
        const items = verifyTable(rows, table.indicators, table.errors);
        expect(items.every((item) => item.result.status === "통과"), `${row.name} ${text}`).toBe(true);
      }
    }
  });
});
