// Design Ref: §4 폴더 구조 — 오류 검증은 AI도 서버도 쓰지 않는 순수 규칙으로 두어 브라우저와 서버가 같이 쓰고 자동 시험을 붙인다.
// Plan SC: PLAN 3번 작업. 원문에서 옮긴 수치는 완전히 같아야 하고, 계산한 증감률은 원자료와 0.1%p를 넘게 다르면 오류로 표시한다.

import { calcGrowthRate, formatSigned } from "./growth";
import type { SourceLocation } from "./indicators";

/** 검증 결과. 통과 / 오류 / 검증 불가(비교할 값이 없거나 계산할 수 없는 경우) */
export type ValidationStatus = "통과" | "오류" | "검증 불가";

export interface ValidationResult {
  status: ValidationStatus;
  /** 담당자가 읽을 설명 */
  message: string;
  /** 원자료 위치. 오류 항목에 함께 보여 주려고 그대로 돌려준다. */
  source: SourceLocation | null;
}

/** 증감률 비교에서 허용하는 차이(0.1%p). 둘 다 소수점 첫째 자리로 반올림된 값이라 이만큼은 정상으로 본다. */
const GROWTH_TOLERANCE_TENTHS = 1;

/**
 * 원문에서 그대로 옮긴 수치가 원자료와 완전히 같은지 본다.
 * 한 글자라도 다르면 오류다. (공백, % 기호, △와 - 의 차이도 다른 글자로 본다.)
 */
export function checkExactMatch(
  reported: string,
  transcribed: string,
  source: SourceLocation | null = null,
): ValidationResult {
  if (reported === "") {
    return { status: "검증 불가", message: "원자료 값이 비어 있어 비교할 수 없습니다.", source };
  }
  if (reported === transcribed) {
    return { status: "통과", message: `원자료와 같습니다. (${reported})`, source };
  }
  return {
    status: "오류",
    message: `원자료는 "${reported}"인데 옮긴 값은 "${transcribed}"입니다.`,
    source,
  };
}

/**
 * 원자료가 적은 증감률(%)과, 지수로 다시 계산한 증감률을 비교한다.
 * 차이가 0.1%p를 넘으면 오류다. 원자료 증감률은 소수점 첫째 자리 값이라고 보고 비교한다.
 * @param reportedRate 원자료에 적힌 증감률(%)
 * @param current 당월 지수
 * @param base 비교 기간(전월 또는 전년동월) 지수
 */
export function checkGrowthRate(
  reportedRate: number,
  current: number,
  base: number,
  source: SourceLocation | null = null,
): ValidationResult {
  if (!Number.isFinite(reportedRate)) {
    return { status: "검증 불가", message: "원자료 증감률이 숫자가 아니어서 비교할 수 없습니다.", source };
  }
  const computed = calcGrowthRate(current, base);
  if (computed === null) {
    return {
      status: "검증 불가",
      message: "지수가 숫자가 아니거나 비교 기간 지수가 0 이하라서 증감률을 다시 계산할 수 없습니다.",
      source,
    };
  }

  const reportedText = formatSigned(reportedRate, "%");
  const computedText = formatSigned(computed, "%");
  // 소수점 오차(0.1000…05 같은 값)로 경계가 어긋나지 않도록 0.1 단위의 정수로 바꿔 비교한다.
  const diffTenths = Math.round(Math.abs(computed - reportedRate) * 10);

  if (diffTenths > GROWTH_TOLERANCE_TENTHS) {
    return {
      status: "오류",
      message: `원자료 ${reportedText}와 계산값 ${computedText}의 차이가 ${(diffTenths / 10).toFixed(1)}%p로 허용 범위(0.1%p)를 넘습니다.`,
      source,
    };
  }
  return {
    status: "통과",
    message:
      diffTenths === 0
        ? `원자료 ${reportedText}와 계산값이 같습니다.`
        : `원자료 ${reportedText}와 계산값 ${computedText}의 차이가 0.1%p라 반올림 차이로 보고 정상으로 봅니다.`,
    source,
  };
}
