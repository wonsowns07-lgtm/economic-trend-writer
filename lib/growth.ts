// Design Ref: §4 폴더 구조 — 증감률 계산과 △·%p 표기는 AI도 서버도 쓰지 않는 순수 규칙으로 두어,
// 브라우저와 서버가 같이 쓰고 자동 시험을 붙이기 쉽게 한다.
// Plan SC: PLAN 2번 작업. 증감률은 소수점 첫째 자리까지 계산하고, 감소는 △, 증감폭은 %p로 표기한다.

/** 소수점 첫째 자리까지 반올림한다. 0.5는 0에서 먼 쪽으로 올린다. (예: 0.25 → 0.3, △0.25 → △0.3) */
export function roundToTenth(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError("유한한 숫자만 반올림할 수 있습니다.");
  }
  const sign = value < 0 ? -1 : 1;
  // 부동소수점 오차(예: 2.4999999…)로 반올림이 어긋나지 않도록 아주 작은 값을 더한다.
  const rounded = (sign * Math.round(Math.abs(value) * 10 + 1e-9)) / 10;
  // -0이 되면 0으로 바꿔 "△0.0"처럼 보이지 않게 한다.
  return rounded === 0 ? 0 : rounded;
}

/**
 * 증감률(%)을 계산한다. (당월 − 비교 기간) ÷ 비교 기간 × 100을 소수점 첫째 자리까지 반올림한다.
 * 비교 기간 값이 0 이하이거나 숫자가 아니면 계산할 수 없으므로 null을 돌려준다.
 */
export function calcGrowthRate(current: number, base: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(base) || base <= 0) {
    return null;
  }
  return roundToTenth(((current - base) / base) * 100);
}

/** 두 값의 차이(당월 − 비교 기간)를 소수점 첫째 자리까지 반올림한다. 경기지수의 전월차 같은 곳에 쓴다. */
export function calcDifference(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return null;
  }
  return roundToTenth(current - previous);
}

/**
 * 화면에 보일 문자열로 바꾼다. 소수점 첫째 자리까지 쓰고, 감소는 △, 증가와 0은 부호 없이 쓴다.
 * 뒤에 붙일 단위(%, %p, p 등)는 호출하는 쪽에서 정한다. (예: formatSigned(-4.8, "%") → "△4.8%")
 */
export function formatSigned(value: number, suffix = ""): string {
  const rounded = roundToTenth(value);
  const text = Math.abs(rounded).toFixed(1);
  return `${rounded < 0 ? "△" : ""}${text}${suffix}`;
}

// 숫자 앞에 올 수 있는 부호. 감소를 뜻하는 것만 인정한다.
// ▲는 문서에 따라 증가·감소 어느 쪽으로도 쓰여 방향을 알 수 없으므로 일부러 받지 않는다.
const NEGATIVE_SIGNS = new Set(["△", "-", "−", "–", "－"]);
const SIGNED_NUMBER = /^\s*([△\-−–－+＋])?\s*(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(?:%p|%|p)?\s*$/;

/**
 * "△4.8", "-4.8%", "2,926.6", "0.2%p"처럼 화면·작성본에 적힌 글자를 숫자로 바꾼다. (formatSigned의 반대)
 * △·-·−·–·－는 감소(음수), +는 증가로 읽는다. 뒤의 %, %p, p와 천 단위 쉼표, 앞뒤 공백은 무시한다.
 * 읽을 수 없는 글자(▲처럼 뜻이 모호한 부호 포함)는 추측하지 않고 null을 돌려준다.
 */
export function parseSigned(text: string): number | null {
  const match = SIGNED_NUMBER.exec(text);
  if (!match) {
    return null;
  }
  const [, sign, digits] = match;
  const magnitude = Number(digits.replaceAll(",", ""));
  if (!Number.isFinite(magnitude)) {
    return null;
  }
  const value = sign !== undefined && NEGATIVE_SIGNS.has(sign) ? -magnitude : magnitude;
  // -0이 되면 0으로 바꿔 돌려준다.
  return value === 0 ? 0 : value;
}
