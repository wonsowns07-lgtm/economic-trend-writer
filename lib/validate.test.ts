import { describe, expect, it } from "vitest";
import { checkExactMatch, checkGrowthRate } from "./validate";

const where = { page: 3, table: "표1" };

describe("checkExactMatch (옮긴 수치는 완전 일치)", () => {
  it("같으면 통과다", () => {
    expect(checkExactMatch("△4.8%", "△4.8%").status).toBe("통과");
  });

  it("한 글자라도 다르면 오류다", () => {
    expect(checkExactMatch("△4.8%", "△4.9%").status).toBe("오류");
    expect(checkExactMatch("△4.8%", "-4.8%").status).toBe("오류");
    expect(checkExactMatch("△4.8%", "△4.8 %").status).toBe("오류");
    expect(checkExactMatch("1.9%", "1.9").status).toBe("오류");
  });

  it("원자료 값이 비어 있으면 검증 불가다", () => {
    expect(checkExactMatch("", "1.9%").status).toBe("검증 불가");
  });

  it("오류 설명에 두 값이 모두 나오고 원자료 위치를 그대로 돌려준다", () => {
    const result = checkExactMatch("△4.8%", "△4.9%", where);
    expect(result.message).toContain("△4.8%");
    expect(result.message).toContain("△4.9%");
    expect(result.source).toEqual(where);
  });
});

describe("checkGrowthRate (계산한 증감률은 0.1%p 이내)", () => {
  it("계산값과 같으면 통과다", () => {
    expect(checkGrowthRate(1.9, 101.9, 100).status).toBe("통과");
    expect(checkGrowthRate(-1.3, 98.7, 100).status).toBe("통과");
  });

  it("0.1%p 차이는 반올림 차이로 보고 통과다", () => {
    // 95.1 / 100 → 계산값 △4.9, 원자료 △4.8
    const result = checkGrowthRate(-4.8, 95.1, 100);
    expect(result.status).toBe("통과");
    expect(result.message).toContain("0.1%p");
  });

  it("0.1%p를 넘으면 오류다", () => {
    // 계산값 △4.9, 원자료 △4.7 → 차이 0.2%p
    expect(checkGrowthRate(-4.7, 95.1, 100).status).toBe("오류");
    // 부호가 반대로 적힌 경우
    expect(checkGrowthRate(1.3, 98.7, 100).status).toBe("오류");
  });

  it("오류 설명에 두 값과 차이가 나오고 위치를 돌려준다", () => {
    const result = checkGrowthRate(-4.7, 95.1, 100, where);
    expect(result.message).toContain("△4.7%");
    expect(result.message).toContain("△4.9%");
    expect(result.message).toContain("0.2%p");
    expect(result.source).toEqual(where);
  });

  it("부동소수점 오차 때문에 경계가 틀어지지 않는다", () => {
    // 4.9 − 4.8 같은 계산이 0.10000000000000053이 되어도 0.1%p로 본다.
    expect(checkGrowthRate(-4.8, 95.1, 100).status).toBe("통과");
    expect(checkGrowthRate(0.3, 100.4, 100).status).toBe("통과");
  });

  it("계산할 수 없으면 검증 불가다", () => {
    expect(checkGrowthRate(1.9, 101.9, 0).status).toBe("검증 불가");
    expect(checkGrowthRate(1.9, Number.NaN, 100).status).toBe("검증 불가");
    expect(checkGrowthRate(Number.NaN, 101.9, 100).status).toBe("검증 불가");
  });
});
