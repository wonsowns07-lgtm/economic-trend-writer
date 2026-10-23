// Design Ref: §1 화면 구성 ② — 담당자가 빈칸을 채우고 잘못 뽑힌 수치를 고친다. 고친 결과가 이후 단계(검증·대조·초안)가 쓰는 수치가 된다.
// Plan SC: PLAN 9번 작업. 화면과 상관없는 순수 규칙으로 두어 시험하기 쉽게 한다.

import { EXPECTED_INDICATORS } from "./extract";
import { parseSigned } from "./growth";
import type { Indicator } from "./indicators";

/** 표의 한 줄을 구분하는 열쇠. 같은 지표·비교 기준은 한 줄뿐이다. */
export function rowKey(indicator: Pick<Indicator, "name" | "comparison">): string {
  return `${indicator.name}|${indicator.comparison}`;
}

/** 입력칸에 처음 보여 줄 글자. 원자료에서 읽은 값은 원자료 글자 그대로, 빈칸은 비워 둔다. */
export function initialText(indicator: Indicator): string {
  if (indicator.rawText !== null) return indicator.rawText;
  return indicator.value === null ? "" : String(indicator.value);
}

export interface RowResult {
  /** 입력한 글자를 반영한 수치 한 줄. 입력이 잘못되면 원래 줄 그대로다. */
  indicator: Indicator;
  /** 입력을 숫자로 읽을 수 없을 때의 안내. 문제가 없으면 null */
  error: string | null;
}

/**
 * 입력칸에 쓴 글자를 반영한다.
 * - 비우면 "빈칸", 원래 값과 같은 숫자면 "추출됨" 그대로, 다른 숫자면 "직접 입력"이 된다.
 * - 숫자로 읽을 수 없으면 원래 줄을 그대로 두고 안내를 돌려준다. (잘못된 값이 조용히 들어가지 않게)
 * @param original 원자료에서 읽은 그대로의 줄 (한 번 고친 줄이 아니라 처음 상태)
 */
export function applyEdit(original: Indicator, text: string): RowResult {
  const trimmed = text.trim();

  if (trimmed === "") {
    return {
      indicator: {
        name: original.name,
        period: original.period,
        comparison: original.comparison,
        unit: original.unit,
        source: original.source,
        indexes: original.indexes,
        value: null,
        status: "빈칸",
        rawText: null,
      },
      error: null,
    };
  }

  const value = parseSigned(trimmed);
  if (value === null) {
    return { indicator: original, error: "숫자로 읽을 수 없습니다. 예: -1.3 또는 △1.3" };
  }

  if (original.status === "추출됨" && original.value === value) {
    return { indicator: original, error: null };
  }

  return {
    indicator: {
      name: original.name,
      period: original.period,
      comparison: original.comparison,
      unit: original.unit,
      source: original.source,
      indexes: original.indexes,
      value,
      status: "직접 입력",
      rawText: null,
    },
    error: null,
  };
}

export interface TableState {
  indicators: Indicator[];
  /** 줄 열쇠 → 안내. 입력이 잘못된 줄만 들어 있다. */
  errors: Record<string, string>;
}

/** 처음 상태의 줄들에 입력 글자들을 모두 반영한 표를 만든다. */
export function buildTable(originals: readonly Indicator[], texts: Readonly<Record<string, string>>): TableState {
  const errors: Record<string, string> = {};
  const indicators = originals.map((original) => {
    const key = rowKey(original);
    const text = texts[key];
    if (text === undefined) return original;
    const result = applyEdit(original, text);
    if (result.error) errors[key] = result.error;
    return result.indicator;
  });
  return { indicators, errors };
}

/** "2026-08" → "2026년 8월". 형식이 다르면 그대로 돌려준다. */
export function formatPeriod(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  return match ? `${match[1]}년 ${Number(match[2])}월` : period;
}

/** 원자료 위치를 "6쪽 · 전산업생산"처럼 보여 준다. 위치가 없으면 "—" */
export function formatSource(source: Indicator["source"]): string {
  return source ? `${source.page}쪽 · ${source.table}` : "—";
}

/**
 * 자동 추출에 실패했을 때 여는 빈 표. 찾는 수치 8줄이 모두 "빈칸"이라, 담당자가 보도자료를 보고 직접 입력할 수 있다.
 * @param period 어느 달 자료인지. 알 수 없으면 null (화면에서 직접 적게 한다)
 */
export function blankTable(period: string | null): Indicator[] {
  return EXPECTED_INDICATORS.map(({ name, comparison, unit }) => ({
    name,
    period: period ?? "",
    comparison,
    unit,
    source: null,
    indexes: null,
    value: null,
    status: "빈칸",
    rawText: null,
  }));
}
