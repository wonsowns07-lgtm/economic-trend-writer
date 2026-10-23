// Design Ref: §2.3 수치 한 줄의 형태 — 모든 단계(추출·계산·검증·대조·초안)가 같은 형태를 쓰게 한다.
// Plan SC: PLAN 1번 작업. 수치 오기입 0건을 위해 값이 없는 칸(빈칸)과 값이 있는 칸을 타입으로 구분한다.

/** 다루는 지표. 이번 범위인 산업활동동향의 핵심 수치만 둔다. */
export const INDICATOR_NAMES = [
  "전산업생산",
  "소매판매",
  "설비투자",
  "경기동행지수",
  "경기선행지수",
] as const;

/** 비교 기준. 경기지수의 순환변동치는 전월과의 차이(전월차)로 표기한다. */
export const COMPARISONS = ["전월비", "전년동월비", "전월차"] as const;

/** 값의 단위. 증감률은 %, 증감폭은 %p, 경기지수의 전월차는 p(포인트), 지수 그대로의 값은 지수. */
export const UNITS = ["%", "%p", "p", "지수"] as const;

/** 수치가 어떻게 채워졌는지. */
export const INDICATOR_STATUSES = ["추출됨", "빈칸", "직접 입력"] as const;

export type IndicatorName = (typeof INDICATOR_NAMES)[number];
export type Comparison = (typeof COMPARISONS)[number];
export type Unit = (typeof UNITS)[number];
export type IndicatorStatus = (typeof INDICATOR_STATUSES)[number];

/** 원자료에서 수치가 있는 곳. 오류 항목에 함께 보여 주기 위해 쓴다. (예: 3쪽 표1) */
export interface SourceLocation {
  /** 쪽 번호 */
  page: number;
  /** 표 이름 */
  table: string;
}

/** 증감률을 다시 계산할 때 쓰는 지수 한 쌍. 원자료의 증감률과 비교하는 데 쓴다. */
export interface IndexPair {
  /** 당월 지수 */
  current: number;
  /** 비교 기간(전월 또는 전년동월) 지수 */
  base: number;
}

/** 모든 상태가 공통으로 가지는 항목. */
interface IndicatorBase {
  /** 무엇의 수치인지 */
  name: IndicatorName;
  /** 어느 달인지. "2026-08"처럼 연-월로 적는다. */
  period: string;
  /** 비교 기준 */
  comparison: Comparison;
  /** 단위 */
  unit: Unit;
  /** 원자료 위치. 추출하지 못한 칸은 위치를 모를 수 있어 null이다. */
  source: SourceLocation | null;
  /** 증감률을 다시 계산할 지수. 원자료에서 찾지 못했거나 계산이 필요 없는 칸은 null이다. */
  indexes: IndexPair | null;
}

/** 원자료에서 추출한 칸. 감소는 음수로 저장하고, 화면에 보일 때 △로 바꿔 쓴다. */
export interface ExtractedIndicator extends IndicatorBase {
  value: number;
  status: "추출됨";
  /** 원자료에 적힌 글자 그대로. (예: "△1.3") "한 글자라도 다르면 오류" 비교에 쓴다. */
  rawText: string;
}

/** 담당자가 직접 입력한 칸. 비교할 원자료 글자가 없으므로 rawText는 null이다. */
export interface ManualIndicator extends IndicatorBase {
  value: number;
  status: "직접 입력";
  rawText: null;
}

/** 추출하지 못해 비어 있는 칸. 담당자가 직접 입력해야 한다. */
export interface BlankIndicator extends IndicatorBase {
  value: null;
  status: "빈칸";
  rawText: null;
}

/** 값이 채워진 칸. */
export type FilledIndicator = ExtractedIndicator | ManualIndicator;

/** 수치 한 줄. 상태가 "빈칸"일 때만 값이 null이다. */
export type Indicator = FilledIndicator | BlankIndicator;
