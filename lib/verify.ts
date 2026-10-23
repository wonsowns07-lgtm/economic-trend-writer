// Design Ref: §1 화면 구성 ③ — 오류 검증 결과. 수치마다 원자료와 맞는지 보고, 다르면 무엇이 다른지와 원자료 위치를 함께 보여 준다.
// Plan SC: PLAN 10번 작업. 앞서 만든 검증 규칙(validate.ts)을 표의 줄마다 적용한다. AI 없이 코드로만 한다.

import type { Comparison, FilledIndicator, Indicator, IndicatorName } from "./indicators";
import { rowKey } from "./table";
import { checkGrowthRate, type ValidationResult, type ValidationStatus } from "./validate";

/** 검증 결과 한 건. */
export interface VerificationItem {
  name: IndicatorName;
  comparison: Comparison;
  /** 무엇을 검사했는지 (예: "원자료와 비교", "증감률 다시 계산") */
  check: string;
  result: ValidationResult;
}

/**
 * 표의 줄마다 원자료와 맞는지 검증한다.
 * - 추출된 값 그대로이면 통과다.
 * - 추출된 값을 다른 숫자로 고쳤으면 오류다. (원자료와 달라졌다는 뜻이므로 담당자가 다시 확인해야 한다.)
 * - 비어 있거나 처음부터 직접 입력한 값은 비교할 원자료 글자가 없으므로 검증 불가다.
 * - 지수가 있는 줄은 증감률을 다시 계산해 원자료와 0.1%p 이내인지도 본다.
 * @param originals 원자료에서 읽은 그대로의 줄들
 * @param current 담당자가 고친 것까지 반영한 줄들 (originals와 같은 순서)
 * @param errors 입력을 숫자로 읽지 못한 줄 (줄 열쇠 → 안내)
 */
export function verifyTable(
  originals: readonly Indicator[],
  current: readonly Indicator[],
  errors: Readonly<Record<string, string>> = {},
): VerificationItem[] {
  const items: VerificationItem[] = [];

  originals.forEach((original, index) => {
    const row = current[index];
    const base = { name: row.name, comparison: row.comparison };
    const source = row.source ?? original.source;

    let result: ValidationResult;
    if (errors[rowKey(row)]) {
      result = {
        status: "오류",
        message: "입력한 글자를 숫자로 읽을 수 없어, 이전 값을 그대로 쓰고 있습니다. 숫자로 고쳐 주세요.",
        source,
      };
    } else if (row.status === "추출됨") {
      result = { status: "통과", message: `원자료 글자 그대로입니다. (${row.rawText})`, source };
    } else if (row.status === "직접 입력" && original.status === "추출됨" && original.rawText !== null) {
      result = {
        status: "오류",
        message: `원자료는 ${original.rawText}인데 입력한 값은 ${row.value}입니다. 원자료 위치를 다시 확인해 주세요.`,
        source,
      };
    } else if (row.status === "직접 입력") {
      result = {
        status: "검증 불가",
        message: "직접 입력한 값이라 원자료 글자와 비교할 수 없습니다. 원자료 위치에서 직접 확인해 주세요.",
        source,
      };
    } else {
      result = { status: "검증 불가", message: "값이 비어 있습니다. 직접 입력해 주세요.", source };
    }
    items.push({ ...base, check: "원자료와 비교", result });

    // 지수를 알고 있으면 증감률을 다시 계산해 본다. (지수를 가져오는 작업이 끝나면 저절로 동작한다.)
    if (row.value !== null && row.unit === "%" && row.indexes !== null) {
      items.push({
        ...base,
        check: "증감률 다시 계산",
        result: checkGrowthRate(row.value, row.indexes.current, row.indexes.base, source),
      });
    }
  });

  return items;
}

/**
 * 검증을 통과한 수치만 골라낸다. 한 줄의 검사 결과가 모두 통과이고 값이 있는 줄만 남긴다.
 * (오류, 확인 불가, 빈칸, 직접 입력한 값은 종합평가 초안에 쓰지 않는다.)
 */
export function selectPassed(
  current: readonly Indicator[],
  items: readonly VerificationItem[],
): FilledIndicator[] {
  const passed: FilledIndicator[] = [];
  for (const row of current) {
    if (row.status !== "추출됨") continue;
    const own = items.filter((item) => item.name === row.name && item.comparison === row.comparison);
    if (own.length > 0 && own.every((item) => item.result.status === "통과")) passed.push(row);
  }
  return passed;
}

export interface VerificationSummary {
  통과: number;
  오류: number;
  "검증 불가": number;
}

export function summarize(items: readonly VerificationItem[]): VerificationSummary {
  const summary: VerificationSummary = { 통과: 0, 오류: 0, "검증 불가": 0 };
  for (const item of items) summary[item.result.status as ValidationStatus] += 1;
  return summary;
}
