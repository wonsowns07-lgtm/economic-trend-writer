import { describe, expect, it } from "vitest";
import fixture from "./fixtures/trade-2026-09.json";
import { deriveTradePeriod, formatTradeCell, millionToHundredMillion, parseTrade, toTabRow, TRADE_REGIONS } from "./trade";

// 실제 산업통상부 「2026년 9월 수출입동향」 보도자료(공개자료)에서 필요한 쪽의 글자만 옮겨 둔 것이다.
const pages: string[] = fixture;
const values = (line: ReturnType<typeof parseTrade>["total"]) => Object.values(line).map((c) => c.value);

describe("millionToHundredMillion", () => {
  it("백만 달러를 억불 소수점 첫째 자리로 바꾼다", () => {
    expect(millionToHundredMillion(120_944)).toBe(1209.4);
    expect(millionToHundredMillion(49_852)).toBe(498.5);
    expect(millionToHundredMillion(-2_019)).toBe(-20.2);
    expect(millionToHundredMillion(0)).toBe(0);
  });
});

describe("deriveTradePeriod", () => {
  it("제목에서 달을 읽는다", () => {
    expect(deriveTradePeriod(pages)).toBe("2026-09");
  });
  it("산업활동동향 같은 다른 자료는 달을 읽지 못한다", () => {
    expect(deriveTradePeriod(["2026년 8월 산업활동동향"])).toBeNull();
  });
});

describe("parseTrade — 실제 9월 보도자료", () => {
  const result = parseTrade(pages);

  it("전체 수출입 한 줄이 부록 표 단위(억불)로 채워진다", () => {
    expect(result.period).toBe("2026-09");
    expect(values(result.total)).toEqual([1209.4, 83.5, 710.9, 26.0, 498.5]);
    expect(result.total["수출 금액"].source?.page).toBe(28);
    expect(result.total["수출 금액"].rawText).toBe("120,944");
  });

  it("지역별 한 줄이 채워지고 수출입차는 계산한 칸으로 표시된다", () => {
    expect(values(result.regions["미국"])).toEqual([243.3, 137.0, 70.6, 18.9, 172.7]);
    expect(values(result.regions["일본"])).toEqual([32.1, 25.3, 52.3, 22.5, -20.2]);
    expect(values(result.regions["중국"])).toEqual([260.1, 122.7, 192.9, 42.8, 67.2]);
    expect(values(result.regions["EU(27)"])).toEqual([86.5, 20.9, 72.1, 5.6, 14.4]);
    expect(result.regions["미국"].수출입차.derived).toBe(true);
    expect(result.regions["미국"]["수출 금액"].derived).toBe(false);
  });

  it("모든 칸이 채워지고 경고가 없다", () => {
    expect(result.warnings).toEqual([]);
    for (const region of TRADE_REGIONS) expect(values(result.regions[region]).every((v) => v !== null)).toBe(true);
  });

  it("복사용 한 줄은 탭으로 나뉘고 감소는 △로 쓴다", () => {
    expect(toTabRow(result.total)).toBe("1,209.4\t83.5\t710.9\t26.0\t498.5");
    expect(toTabRow(result.regions["일본"])).toBe("32.1\t25.3\t52.3\t22.5\t△20.2");
    expect(formatTradeCell(null)).toBe("");
  });
});

describe("parseTrade — 틀리거나 빠졌을 때는 빈칸", () => {
  const swap = (pageNumber: number, from: string, to: string) => {
    expect(pages[pageNumber - 1]).toContain(from);
    return pages.map((text, i) => (i === pageNumber - 1 ? text.replace(from, to) : text));
  };

  it("수출−수입이 수출입차와 다르면 전체 줄을 빈칸으로 둔다", () => {
    const result = parseTrade(swap(28, "9 120,944 83.5 71,092 26.0 49,852", "9 120,944 83.5 71,092 26.0 59,852"));
    expect(values(result.total)).toEqual([null, null, null, null, null]);
    expect(result.warnings.join(" ")).toContain("수출입차");
  });

  it("두 표의 증감률이 다르면 증가율 칸만 빈칸으로 둔다", () => {
    const result = parseTrade(swap(28, "9 120,944 83.5 71,092", "9 120,944 38.5 71,092"));
    expect(result.total["수출 증가율"].value).toBeNull();
    expect(result.total["수출 금액"].value).toBe(1209.4);
  });

  it("지역 표의 마지막 달이 이번 달이 아니면 그 지역 칸을 빈칸으로 둔다", () => {
    const stale = pages.map((text, i) => (i === 21 ? text.replace(/8월 9월\n/, "8월 8월\n") : text));
    expect(stale[21]).not.toBe(pages[21]);
    const result = parseTrade(stale);
    expect(result.regions["중국"]["수출 금액"].value).toBeNull();
    expect(result.regions["중국"]["수입 금액"].value).toBe(192.9);
  });

  it("지역 수출입차가 무역수지 표와 크게 다르면 빈칸으로 둔다", () => {
    const result = parseTrade(swap(26, "미국 495 43 24 43 56 52 69 92 80 85 121 85 89 173", "미국 495 43 24 43 56 52 69 92 80 85 121 85 89 150"));
    expect(result.regions["미국"].수출입차.value).toBeNull();
    expect(result.warnings.join(" ")).toContain("미국 수출입차");
  });

  it("엉뚱한 PDF면 모든 칸이 빈칸이고 이유를 알려 준다", () => {
    const result = parseTrade(["2026년 8월 산업활동동향", "아무 글"]);
    expect(result.period).toBeNull();
    expect(values(result.total)).toEqual([null, null, null, null, null]);
    expect(result.warnings).toHaveLength(1);
  });
});
