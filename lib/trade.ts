// 확장 1단계 — 산업통상부 「수출입동향」 보도자료에서 부록 수출입 표의 새 달 한 줄을 채운다.
// AI를 쓰지 않는다. 보도자료의 표는 줄 모양이 정해져 있어 코드로 읽고, 서로 다른 표끼리 맞는지 다시 확인한다.
// 확인이 안 되는 칸은 빈칸(null)으로 두어 담당자가 직접 입력하게 한다. (틀린 수치가 조용히 들어오는 것을 막기 위함)

import { parseSigned } from "./growth";

/** 부록 표에 적는 지역. 보도자료의 지역 이름과 같다. */
export const TRADE_REGIONS = ["미국", "일본", "중국", "EU(27)"] as const;
export type TradeRegion = (typeof TRADE_REGIONS)[number];

/** 부록 표 한 줄의 칸 이름. */
export const TRADE_FIELDS = ["수출 금액", "수출 증가율", "수입 금액", "수입 증가율", "수출입차"] as const;
export type TradeField = (typeof TRADE_FIELDS)[number];

export interface TradeCell {
  /** 부록 표에 적는 값. 금액은 억불(소수점 첫째 자리), 증가율은 %. 확인하지 못했으면 null이다. */
  value: number | null;
  /** 보도자료에 적힌 글자 그대로(금액은 백만 달러). 계산한 칸이나 빈칸은 null이다. */
  rawText: string | null;
  /** 원자료 위치. 빈칸은 null이다. */
  source: { page: number; table: string } | null;
  /** 보도자료에 없어 수출과 수입으로 계산한 칸. (수출입차) */
  derived: boolean;
}

export type TradeLine = Record<TradeField, TradeCell>;

export interface TradeResult {
  /** 어느 달 자료인지. "2026-09"처럼 적는다. 못 읽으면 null이다. */
  period: string | null;
  /** 전체 수출입(통관) 한 줄 */
  total: TradeLine;
  /** 지역별 한 줄씩 */
  regions: Record<TradeRegion, TradeLine>;
  /** 담당자에게 알릴 말 (왜 빈칸인지 등) */
  warnings: string[];
}

const NUMBER = String.raw`[△\-−]?\d[\d,]*(?:\.\d+)?`;

function blankCell(): TradeCell {
  return { value: null, rawText: null, source: null, derived: false };
}

function blankLine(): TradeLine {
  return {
    "수출 금액": blankCell(),
    "수출 증가율": blankCell(),
    "수입 금액": blankCell(),
    "수입 증가율": blankCell(),
    수출입차: blankCell(),
  };
}

/** 백만 달러를 억불로 바꾼다. 소수점 첫째 자리까지, 0.5는 0에서 먼 쪽으로 올린다. (120,944 → 1209.4) */
export function millionToHundredMillion(million: number): number {
  const sign = million < 0 ? -1 : 1;
  const value = (sign * Math.round(Math.abs(million) / 10)) / 10;
  return value === 0 ? 0 : value;
}

function cell(rawText: string, page: number, table: string, unit: "금액" | "증가율"): TradeCell {
  const number = parseSigned(rawText);
  if (number === null) return blankCell();
  return {
    value: unit === "금액" ? millionToHundredMillion(number) : number,
    rawText,
    source: { page, table },
    derived: false,
  };
}

function derivedCell(value: number, page: number, table: string): TradeCell {
  return { value, rawText: null, source: { page, table }, derived: true };
}

/** 보도자료 제목("2026년 9월 수출입 동향")에서 어느 달 자료인지 읽는다. */
export function deriveTradePeriod(pages: readonly string[]): string | null {
  for (const text of pages.slice(0, 3)) {
    const match = /(\d{4})\s*년\s*(\d{1,2})\s*월\s*수출입\s*동향/.exec(text);
    if (match) return `${match[1]}-${match[2].padStart(2, "0")}`;
  }
  return null;
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

const numbersIn = (line: string) => line.match(new RegExp(NUMBER, "g")) ?? [];

const TOTAL_TABLE = "연도별 수출입 실적 통계";

/** 전체 수출입 표에서 이번 달 줄(월 금액 증가율 금액 증가율 수출입차)을 찾는다. */
function readTotalRow(pages: readonly string[], year: number, month: number): { page: number; tokens: string[] } | null {
  for (let index = 0; index < pages.length; index++) {
    if (!pages[index].includes(TOTAL_TABLE)) continue;
    const rows = lines(pages[index]);
    const start = rows.findIndex((line) => line.startsWith(`${year}년`));
    if (start < 0) continue;
    const pattern = new RegExp(`^${month}\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})$`);
    for (const line of rows.slice(start + 1)) {
      const match = pattern.exec(line);
      if (match) return { page: index + 1, tokens: match.slice(1, 6) };
    }
  }
  return null;
}

/** "월별 수출실적"·"월별 수입실적" 표의 맨 오른쪽(이번 달) 증감률 글자. 두 번째 확인용이다. */
function readMonthlyGrowth(pages: readonly string[], heading: string): string | null {
  for (const text of pages) {
    if (!text.includes(heading)) continue;
    const row = lines(text).find((line) => line.startsWith("증감률"));
    if (!row) continue;
    const tokens = numbersIn(row);
    return tokens.length > 0 ? tokens[tokens.length - 1] : null;
  }
  return null;
}

interface RegionReading {
  page: number;
  /** 첫 숫자는 지난해 전체, 나머지는 월별. 맨 끝이 이번 달이다. */
  amounts: string[];
  /** 괄호 안 증감률. amounts와 같은 개수여야 한다. */
  rates: string[];
  /** 표 맨 오른쪽 달 */
  lastMonth: number | null;
}

/** 지역별 수출·수입 표에서 한 지역의 금액 줄과 괄호 증감률 줄을 읽는다. */
function readRegion(pages: readonly string[], heading: RegExp, region: string): RegionReading | null {
  for (let index = 0; index < pages.length; index++) {
    if (!heading.test(pages[index])) continue;
    const rows = lines(pages[index]);
    const monthsRow = rows.find((line) => /^(\d{1,2}월\s*)+$/.test(line));
    const lastMonthMatch = monthsRow ? [...monthsRow.matchAll(/(\d{1,2})월/g)].pop() : undefined;
    const lastMonth = lastMonthMatch ? Number(lastMonthMatch[1]) : null;

    for (let i = 0; i < rows.length; i++) {
      const [first, ...rest] = rows[i].split(/\s+/);
      if (first !== region) continue;
      // 지역 이름 줄에 금액이 바로 붙어 있기도 하고, 다음 줄에 있기도 하다.
      const amountRow = rest.length > 0 ? rest.join(" ") : (rows[i + 1] ?? "");
      const rateRow = rows[i + (rest.length > 0 ? 1 : 2)] ?? "";
      const amounts = numbersIn(amountRow);
      const rates = [...rateRow.matchAll(new RegExp(String.raw`\((${NUMBER})\)`, "g"))].map((m) => m[1]);
      if (amounts.length === 0 || rates.length === 0) continue;
      return { page: index + 1, amounts, rates, lastMonth };
    }
  }
  return null;
}

/** 보도자료 쪽별 글자에서 부록 수출입 표의 새 달 한 줄을 읽는다. */
export function parseTrade(pages: readonly string[]): TradeResult {
  const warnings: string[] = [];
  const period = deriveTradePeriod(pages);
  const total = blankLine();
  const regions = Object.fromEntries(TRADE_REGIONS.map((region) => [region, blankLine()])) as Record<TradeRegion, TradeLine>;

  if (period === null) {
    warnings.push("어느 달 자료인지 알 수 없어 모든 칸을 빈칸으로 두었습니다. 수출입동향 보도자료가 맞는지 확인해 주세요.");
    return { period, total, regions, warnings };
  }
  const [year, month] = period.split("-").map(Number);

  // 1) 전체 수출입(통관)
  const row = readTotalRow(pages, year, month);
  if (!row) {
    warnings.push(`전체 수출입: '${TOTAL_TABLE}' 표에서 ${month}월 줄을 찾지 못해 빈칸으로 두었습니다. 직접 입력해 주세요.`);
  } else {
    const [exp, expRate, imp, impRate, balance] = row.tokens;
    const [expNum, impNum, balNum] = [exp, imp, balance].map((text) => parseSigned(text));
    // 수출 − 수입 = 수출입차가 맞아야 한 줄 전체를 믿는다.
    if (expNum === null || impNum === null || balNum === null || Math.abs(expNum - impNum - balNum) > 1) {
      warnings.push("전체 수출입: 수출에서 수입을 뺀 값이 보도자료의 수출입차와 달라 빈칸으로 두었습니다. 직접 확인해 주세요.");
    } else {
      const table = `수출입(통관) ${TOTAL_TABLE}`;
      total["수출 금액"] = cell(exp, row.page, table, "금액");
      total["수입 금액"] = cell(imp, row.page, table, "금액");
      total.수출입차 = cell(balance, row.page, table, "금액");
      // 증감률은 다른 표(월별 수출실적·수입실적)의 같은 달 값과 같을 때만 쓴다.
      const checks: Array<[TradeField, string, string, string]> = [
        ["수출 증가율", expRate, "월별 수출실적", "수출"],
        ["수입 증가율", impRate, "월별 수입실적", "수입"],
      ];
      for (const [field, raw, heading, label] of checks) {
        const other = readMonthlyGrowth(pages, heading);
        if (other !== null && parseSigned(other) === parseSigned(raw)) {
          total[field] = cell(raw, row.page, table, "증가율");
        } else {
          warnings.push(`전체 ${label} 증가율: 두 표의 값이 서로 다르거나 확인할 표를 찾지 못해 빈칸으로 두었습니다. 직접 입력해 주세요.`);
        }
      }
    }
  }

  // 2) 지역별. 수출 표와 수입 표를 읽고, 수출입차는 둘의 차이로 계산한다.
  for (const region of TRADE_REGIONS) {
    const exp = readRegion(pages, /지역별\s*\d+월\s*수출\s*추이/, region);
    const imp = readRegion(pages, /지역별\s*\d+월\s*수입\s*추이/, region);
    const line = regions[region];
    const exportTable = `주요 지역별 수출 추이 (${region})`;
    const importTable = `지역별 수입 추이 (${region})`;
    const usable = (reading: RegionReading | null, label: string) => {
      if (!reading) {
        warnings.push(`${region} ${label}: 표에서 지역 줄을 찾지 못해 빈칸으로 두었습니다. 직접 입력해 주세요.`);
        return null;
      }
      if (reading.lastMonth !== month || reading.amounts.length !== reading.rates.length) {
        warnings.push(`${region} ${label}: 표의 마지막 달이 ${month}월이 아니거나 금액과 증감률의 개수가 맞지 않아 빈칸으로 두었습니다. 직접 입력해 주세요.`);
        return null;
      }
      return reading;
    };
    const e = usable(exp, "수출");
    const i = usable(imp, "수입");
    if (e) {
      line["수출 금액"] = cell(e.amounts[e.amounts.length - 1], e.page, exportTable, "금액");
      line["수출 증가율"] = cell(e.rates[e.rates.length - 1], e.page, exportTable, "증가율");
    }
    if (i) {
      line["수입 금액"] = cell(i.amounts[i.amounts.length - 1], i.page, importTable, "금액");
      line["수입 증가율"] = cell(i.rates[i.rates.length - 1], i.page, importTable, "증가율");
    }
    const expMillion = line["수출 금액"].rawText === null ? null : parseSigned(line["수출 금액"].rawText);
    const impMillion = line["수입 금액"].rawText === null ? null : parseSigned(line["수입 금액"].rawText);
    if (expMillion !== null && impMillion !== null) {
      const balance = millionToHundredMillion(expMillion - impMillion);
      // 보도자료의 무역수지 표(정수 억 달러)와 1 넘게 다르면 어딘가 잘못 읽은 것이다.
      const reported = readReportedBalance(pages, region);
      if (reported !== null && Math.abs(Math.round(balance) - reported) > 1) {
        warnings.push(`${region} 수출입차: 계산한 값(${balance})이 무역수지 표(${reported})와 달라 빈칸으로 두었습니다. 직접 확인해 주세요.`);
      } else {
        line.수출입차 = derivedCell(balance, e?.page ?? 0, `${region} 수출 − 수입 (계산)`);
      }
    }
  }

  return { period, total, regions, warnings };
}

/** 무역수지 표("② 주요 국가별 무역수지")에서 지역의 이번 달 값(정수, 억 달러). 못 찾으면 null이다. */
function readReportedBalance(pages: readonly string[], region: string): number | null {
  const name = region === "EU(27)" ? "EU(27)" : region;
  for (const text of pages) {
    if (!text.includes("주요 국가별 무역수지")) continue;
    for (const line of lines(text)) {
      const [first, ...rest] = line.split(/\s+/);
      if (first !== name || rest.length < 5) continue;
      const last = rest[rest.length - 1];
      return parseSigned(last);
    }
  }
  return null;
}

/** 칸의 값을 화면·복사용 글자로 바꾼다. 감소는 △, 빈칸은 빈 글자. 금액은 천 단위 쉼표를 쓴다. */
export function formatTradeCell(value: number | null): string {
  if (value === null) return "";
  const text = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${value < 0 ? "△" : ""}${text}`;
}

/** 부록 표에 붙여 넣기 좋게 탭으로 나눈 한 줄. 빈칸은 비워 둔다. */
export function toTabRow(line: TradeLine): string {
  return TRADE_FIELDS.map((field) => formatTradeCell(line[field].value)).join("\t");
}
