import { describe, expect, it } from "vitest";
import {
  calcDifference,
  calcGrowthRate,
  formatSigned,
  parseSigned,
  roundToTenth,
} from "./growth";

describe("roundToTenth (소수점 첫째 자리 반올림)", () => {
  it("일반 값을 첫째 자리로 반올림한다", () => {
    expect(roundToTenth(1.94)).toBe(1.9);
    expect(roundToTenth(1.96)).toBe(2);
    expect(roundToTenth(-1.34)).toBe(-1.3);
  });

  it("0.5는 0에서 먼 쪽으로 올린다", () => {
    expect(roundToTenth(0.25)).toBe(0.3);
    expect(roundToTenth(-0.25)).toBe(-0.3);
    expect(roundToTenth(1.05)).toBe(1.1);
    expect(roundToTenth(2.35)).toBe(2.4);
  });

  it("0에 가까운 음수는 -0이 아니라 0이다", () => {
    expect(Object.is(roundToTenth(-0.04), 0)).toBe(true);
  });

  it("숫자가 아니면 오류를 낸다", () => {
    expect(() => roundToTenth(Number.NaN)).toThrow(RangeError);
    expect(() => roundToTenth(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("calcGrowthRate (증감률 %)", () => {
  it("증가와 감소를 계산한다", () => {
    expect(calcGrowthRate(101.9, 100)).toBe(1.9);
    expect(calcGrowthRate(98.7, 100)).toBe(-1.3);
    expect(calcGrowthRate(95.2, 100)).toBe(-4.8);
  });

  it("값이 같으면 0이다", () => {
    expect(calcGrowthRate(100, 100)).toBe(0);
  });

  it("반올림 경계 값을 바르게 처리한다", () => {
    expect(calcGrowthRate(100.25, 100)).toBe(0.3);
    expect(calcGrowthRate(99.75, 100)).toBe(-0.3);
  });

  it("비교 기간이 0 이하이거나 숫자가 아니면 null이다", () => {
    expect(calcGrowthRate(10, 0)).toBeNull();
    expect(calcGrowthRate(10, -5)).toBeNull();
    expect(calcGrowthRate(Number.NaN, 100)).toBeNull();
    expect(calcGrowthRate(100, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("calcDifference (차이)", () => {
  it("당월에서 이전 값을 뺀 값을 첫째 자리로 돌려준다", () => {
    expect(calcDifference(100.5, 100)).toBe(0.5);
    expect(calcDifference(99.9, 100)).toBe(-0.1);
    expect(calcDifference(100, 100)).toBe(0);
  });

  it("숫자가 아니면 null이다", () => {
    expect(calcDifference(Number.NaN, 1)).toBeNull();
  });
});

describe("formatSigned (△·단위 표기)", () => {
  it("감소는 △를 붙이고 증가와 0은 부호 없이 쓴다", () => {
    expect(formatSigned(-4.8, "%")).toBe("△4.8%");
    expect(formatSigned(1.9, "%")).toBe("1.9%");
    expect(formatSigned(0, "%")).toBe("0.0%");
  });

  it("항상 소수점 첫째 자리까지 쓴다", () => {
    expect(formatSigned(2, "%")).toBe("2.0%");
    expect(formatSigned(-0.04, "%")).toBe("0.0%");
  });

  it("단위를 바꿔 쓸 수 있다", () => {
    expect(formatSigned(0.2, "%p")).toBe("0.2%p");
    expect(formatSigned(-0.1, "p")).toBe("△0.1p");
    expect(formatSigned(3.3)).toBe("3.3");
  });
});

describe("parseSigned (적힌 글자를 숫자로)", () => {
  it("감소 부호는 음수로 읽는다", () => {
    expect(parseSigned("△4.8")).toBe(-4.8);
    expect(parseSigned("-4.8")).toBe(-4.8);
    expect(parseSigned("−4.8")).toBe(-4.8); // 수학 빼기 기호
    expect(parseSigned("－4.8")).toBe(-4.8); // 전각 하이픈
    expect(parseSigned("△ 4.8")).toBe(-4.8);
  });

  it("부호가 없거나 +이면 양수로 읽는다", () => {
    expect(parseSigned("1.9")).toBe(1.9);
    expect(parseSigned("+1.9")).toBe(1.9);
    expect(parseSigned("0")).toBe(0);
  });

  it("뒤의 %, %p, p와 쉼표, 공백은 무시한다", () => {
    expect(parseSigned("△4.8%")).toBe(-4.8);
    expect(parseSigned("0.2%p")).toBe(0.2);
    expect(parseSigned("△0.1p")).toBe(-0.1);
    expect(parseSigned("2,926.6")).toBe(2926.6);
    expect(parseSigned("  1.9 % ")).toBe(1.9);
  });

  it("△0.0은 -0이 아니라 0이다", () => {
    expect(Object.is(parseSigned("△0.0"), 0)).toBe(true);
  });

  it("formatSigned의 결과를 다시 읽으면 같은 값이 나온다", () => {
    for (const value of [-4.8, 0, 1.9, 16.1, -0.3]) {
      expect(parseSigned(formatSigned(value, "%"))).toBe(value);
    }
  });

  it("읽을 수 없는 글자는 추측하지 않고 null이다", () => {
    expect(parseSigned("")).toBeNull();
    expect(parseSigned("abc")).toBeNull();
    expect(parseSigned("▲4.8")).toBeNull(); // 증가인지 감소인지 모호한 부호
    expect(parseSigned("1.2.3")).toBeNull();
    expect(parseSigned("4.8억")).toBeNull();
    expect(parseSigned("△△4.8")).toBeNull();
  });
});
