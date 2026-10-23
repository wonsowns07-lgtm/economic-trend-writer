import { describe, expect, it } from "vitest";
import { compareDraft, summarizeFindings } from "./compare";
import { formatSigned } from "./growth";
import type { Comparison, Indicator, IndicatorName } from "./indicators";

const where = { page: 3, table: "표1" };

/** 시험용 원자료 수치 한 줄. value가 null이면 빈칸이다. */
function make(
  name: IndicatorName,
  comparison: Comparison,
  value: number | null,
): Indicator {
  const base = { name, period: "2026-08", comparison, unit: "%" as const, source: where, indexes: null };
  return value === null
    ? { ...base, value: null, status: "빈칸", rawText: null }
    : { ...base, value, status: "추출됨", rawText: formatSigned(value) };
}

// 2026년 10월 「최근경제동향」 종합평가에 실제로 적힌 8월 수치
const august: Indicator[] = [
  make("전산업생산", "전월비", -1.3),
  make("전산업생산", "전년동월비", 1.9),
  make("소매판매", "전월비", -1.8),
  make("소매판매", "전년동월비", -0.3),
  make("설비투자", "전월비", -9.5),
  make("설비투자", "전년동월비", 16.1),
];

// 같은 종합평가에서 그대로 옮긴 두 문장
const realDraft = [
  "▪ 생산은 건설업(전월비 1.9%, 전년비 1.3%), 서비스업(전월비 0.5%, 전년비 4.6%)에서 증가,",
  "광공업(전월비 △4.8%, 전년비 △2.2%)에서 감소하여 전산업생산(전월비 △1.3%, 전년비 1.9%) 감소",
  "▪ 지출은 소매판매(전월비 △1.8%, 전년비 △0.3%), 설비투자(전월비 △9.5%, 전년비 16.1%) 감소",
].join("\n");

describe("compareDraft — 실제 종합평가 문장", () => {
  const report = compareDraft(realDraft, august);

  it("전산업생산·소매판매·설비투자 숫자 6개를 모두 찾아 일치로 본다", () => {
    expect(report.findings).toHaveLength(6);
    expect(report.findings.every((f) => f.status === "일치")).toBe(true);
    expect(report.findings.map((f) => `${f.name}/${f.comparison}`)).toEqual([
      "전산업생산/전월비",
      "전산업생산/전년동월비",
      "소매판매/전월비",
      "소매판매/전년동월비",
      "설비투자/전월비",
      "설비투자/전년동월비",
    ]);
  });

  it("건설업·서비스업·광공업 숫자는 지표가 아니라서 비교하지 않고 따로 알린다", () => {
    expect(report.unlinked.map((u) => u.text)).toEqual([
      "전월비 1.9%",
      "전년비 1.3%",
      "전월비 0.5%",
      "전년비 4.6%",
      "전월비 △4.8%",
      "전년비 △2.2%",
    ]);
  });

  it("원자료 위치를 결과에 담는다", () => {
    expect(report.findings[0].source).toEqual(where);
  });
});

describe("compareDraft — 불일치", () => {
  it("숫자가 다르면 불일치이고 설명에 두 값이 모두 나온다", () => {
    const report = compareDraft("소매판매(전월비 △1.9%, 전년비 △0.3%)", august);
    const [first, second] = report.findings;
    expect(first.status).toBe("불일치");
    expect(first.message).toContain("△1.9%");
    expect(first.message).toContain("△1.8");
    expect(second.status).toBe("일치");
  });

  it("부호가 반대로 적히면 불일치다", () => {
    const report = compareDraft("소매판매 전월비 1.8%", august);
    expect(report.findings[0].status).toBe("불일치");
  });
});

describe("compareDraft — 표기가 달라도 값이 같으면 일치", () => {
  it("-, 단위 없음, 공백, 쉼표 표기를 같은 값으로 읽는다", () => {
    for (const text of [
      "소매판매 전월비 -1.8%",
      "소매판매 전월비 △1.8",
      "소매판매 전월비 △ 1.8%",
      "소매판매 전월비 −1.8%",
    ]) {
      const report = compareDraft(text, august);
      expect(report.findings[0]?.status, text).toBe("일치");
    }
  });
});

describe("compareDraft — 문장 모양", () => {
  it("'전월대비 … 감소(전년동월비 … 증가)' 모양도 같은 지표로 이어 읽는다", () => {
    const report = compareDraft("전산업생산은 전월대비 △1.3% 감소(전년동월비 1.9% 증가)", august);
    expect(report.findings.map((f) => [f.comparison, f.status])).toEqual([
      ["전월비", "일치"],
      ["전년동월비", "일치"],
    ]);
    expect(report.unlinked).toHaveLength(0);
  });

  it("지표 이름 별칭(설비투자지수)을 알아본다", () => {
    const report = compareDraft("설비투자지수는 전월대비 △9.5% 감소", august);
    expect(report.findings[0]).toMatchObject({ name: "설비투자", status: "일치" });
  });

  it("숫자 사이의 소수점에서 문장이 잘리지 않는다", () => {
    const report = compareDraft("소매판매 전월비 △1.8%. 설비투자 전월비 △9.5%.", august);
    expect(report.findings.map((f) => f.name)).toEqual(["소매판매", "설비투자"]);
  });

  it("퍼센트 증감률이 아닌 숫자(만명 등)는 대상이 아니다", () => {
    const report = compareDraft("취업자는 전년동월비 11.3만명 증가", august);
    expect(report.findings).toHaveLength(0);
    expect(report.unlinked).toHaveLength(0);
  });

  it("지표 이름과 떨어져 있는 숫자는 짐작하지 않고 unlinked로 둔다", () => {
    const report = compareDraft("소매판매가 늘었고 물가는 전년동월비 2.9% 상승", august);
    expect(report.findings).toHaveLength(0);
    expect(report.unlinked).toHaveLength(1);
  });
});

describe("compareDraft — 확인 불가", () => {
  it("원자료에 해당 수치가 없으면 확인 불가다", () => {
    const report = compareDraft("경기동행지수 전월비 0.5%", august);
    expect(report.findings[0].status).toBe("확인 불가");
  });

  it("원자료 칸이 비어 있으면 확인 불가다", () => {
    const report = compareDraft("소매판매 전월비 △1.8%", [make("소매판매", "전월비", null)]);
    expect(report.findings[0].status).toBe("확인 불가");
    expect(report.findings[0].sourceValue).toBeNull();
  });

  it("같은 지표·구분이 둘이면 확인 불가다", () => {
    const twice = [make("소매판매", "전월비", -1.8), make("소매판매", "전월비", -1.8)];
    const report = compareDraft("소매판매 전월비 △1.8%", twice);
    expect(report.findings[0].status).toBe("확인 불가");
  });

  it("뜻이 모호한 부호(▲)는 숫자로 읽지 않고 확인 불가다", () => {
    const report = compareDraft("소매판매 전월비 ▲1.8%", august);
    expect(report.findings[0].status).toBe("확인 불가");
    expect(report.findings[0].writtenValue).toBeNull();
  });
});

describe("compareDraft — 빈 입력", () => {
  it("작성본이 비어 있으면 아무것도 돌려주지 않는다", () => {
    expect(compareDraft("", august)).toEqual({ findings: [], unlinked: [] });
    expect(compareDraft("숫자가 없는 문장입니다.", august)).toEqual({ findings: [], unlinked: [] });
  });
});

describe("summarizeFindings", () => {
  it("상태별 건수를 센다", () => {
    const report = compareDraft(
      "소매판매(전월비 △1.9%, 전년비 △0.3%), 경기동행지수 전월비 0.5%, 전산업생산 전월비 ▲1.3%",
      august,
    );
    expect(summarizeFindings(report.findings)).toEqual({ 일치: 1, 불일치: 1, "확인 불가": 2 });
  });

  it("찾은 숫자가 없으면 모두 0이다", () => {
    expect(summarizeFindings([])).toEqual({ 일치: 0, 불일치: 0, "확인 불가": 0 });
  });
});
