// 교차 확인 — AI가 읽은 값이 환각(없는 숫자를 지어냄)이나 부호·달 착각이 아닌지, AI와 전혀 다른 방법으로 다시 읽어 맞춰 본다.
// AI를 쓰지 않는다. 같은 보도자료 안에서 같은 수치가 적힌 곳을 코드(규칙)로 찾아 읽는다.
//   1) 지표별 작은 표의 맨 아랫줄   2) 「산업활동 주요지표」 표의 맨 오른쪽 칸   3) 본문 문장("전월대비 1.3% 감소"의 숫자와 증가·감소)
// AI가 읽은 값과 이 값들이 모두 같으면 "교차 확인", 하나라도 다르면 "불일치", 다른 곳에서 못 찾으면 "확인 못 함"이다.

import { derivePeriod } from "./extract";
import { parseSigned } from "./growth";
import type { Comparison, IndicatorName } from "./indicators";

/** 규칙으로 읽은 값 한 개. */
export interface SourceReading {
  /** 어디서 읽었는지 (예: "6쪽 지표별 표") */
  where: string;
  /** 쪽 번호 (1부터) */
  page: number;
  /** 문서에 적힌 글자 */
  rawText: string;
  value: number;
}

export type CrossStatus = "교차 확인" | "불일치" | "확인 못 함";

export interface CrossCheckResult {
  status: CrossStatus;
  /** 값이 일치한 곳의 수 */
  agree: number;
  /** 값을 읽은 곳의 수 */
  total: number;
  /** 화면에 보여 줄 한 줄 설명 */
  detail: string;
}

export type SourceReadings = Record<string, SourceReading[]>;

const key = (name: IndicatorName, comparison: Comparison) => `${name}|${comparison}`;

const NUM = String.raw`-?\d+(?:\.\d+)?`;
const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

function push(into: SourceReadings, name: IndicatorName, comparison: Comparison, reading: SourceReading | null) {
  if (!reading) return;
  const k = key(name, comparison);
  (into[k] ??= []).push(reading);
}

function reading(where: string, page: number, rawText: string): SourceReading | null {
  const value = parseSigned(rawText);
  return value === null ? null : { where, page, rawText, value };
}

// 1) 지표별 작은 표: 이름 줄 → "전월비 전년동월비" 줄 → ’25. 8 -0.1 0.2 / ’26. 5 -0.4 1.9 / 6 2.6 4.5 / 8p -1.3 1.9
const TABLE_NAMES: ReadonlyArray<IndicatorName> = ["전산업생산", "소매판매", "설비투자"];
const ROW = new RegExp(String.raw`^(?:’\d{2}\.\s*)?(\d{1,2})p?\s+(${NUM})\s+(${NUM})$`);

function readSmallTables(pages: readonly string[], month: number, into: SourceReadings) {
  pages.forEach((text, index) => {
    const rows = lines(text);
    for (const name of TABLE_NAMES) {
      for (let i = 0; i < rows.length - 2; i++) {
        if (rows[i] !== name || !/^전월비\s+전년동월비$/.test(rows[i + 1])) continue;
        let last: RegExpExecArray | null = null;
        for (let j = i + 2; j < rows.length; j++) {
          const match = ROW.exec(rows[j]);
          if (!match) break;
          last = match;
        }
        if (last && Number(last[1]) === month) {
          const where = `${index + 1}쪽 ${name} 표`;
          push(into, name, "전월비", reading(where, index + 1, last[2]));
          push(into, name, "전년동월비", reading(where, index + 1, last[3]));
        }
      }
    }
  });
}

// 2) 「산업활동 주요지표」 표: 한 줄에 "전월(기)비 - 0.3 -0.1 ... -1.3"처럼 이어지고 맨 오른쪽이 이번 달이다.
function lastNumber(line: string): string | null {
  const tokens = line.match(new RegExp(`(?<![\\d.])${NUM}(?![\\d.])`, "g"));
  return tokens && tokens.length > 0 ? tokens[tokens.length - 1] : null;
}

function readSummaryTable(pages: readonly string[], month: number, into: SourceReadings) {
  pages.forEach((text, index) => {
    if (!/산\s*업\s*활\s*동\s*주\s*요\s*지\s*표/.test(text)) return;
    const rows = lines(text);
    // 표 맨 오른쪽 달이 이번 달인지 머리글("... 7월p 8월p")로 확인한다.
    const header = rows.find((line) => /\d월p?\s*$/.test(line) && /\d월p?\s+\d월p?/.test(line));
    const headerMonth = header ? /(\d{1,2})월p?\s*$/.exec(header)?.[1] : undefined;
    if (headerMonth === undefined || Number(headerMonth) !== month) return;
    const where = `${index + 1}쪽 산업활동 주요지표 표`;

    const pair = (name: IndicatorName, monthlyLine: number) => {
      if (monthlyLine < 0 || !/^전월\(기\)비/.test(rows[monthlyLine]) && !/전월\(기\)비/.test(rows[monthlyLine])) return;
      const next = rows[monthlyLine + 1] ?? "";
      const a = lastNumber(rows[monthlyLine]);
      const b = /^동월\(기\)비/.test(next) ? lastNumber(next) : null;
      if (a) push(into, name, "전월비", reading(where, index + 1, a));
      if (b) push(into, name, "전년동월비", reading(where, index + 1, b));
    };

    pair("전산업생산", rows.findIndex((line) => /^전산업\d?\)?\s+전월\(기\)비/.test(line)));
    pair("소매판매", rows.findIndex((line) => /^소\s*매\s*판\s*매\s+전월\(기\)비/.test(line)));
    // 설비투자는 이름이 줄마다 쪼개져 나온다("설 비" "투 자" 다음 줄이 전월(기)비).
    const equip = rows.findIndex((line, i) => /^설\s*비$/.test(line) && /^투\s*자$/.test(rows[i + 1] ?? "") && /^전월\(기\)비/.test(rows[i + 2] ?? ""));
    pair("설비투자", equip < 0 ? -1 : equip + 2);
  });
}

// 경기종합지수: "동행지수 순환변동치 …" 다음 줄 "․전월차(p) 0.2 -0.4 0.5 0.8 0.5". 맨 오른쪽이 이번 달이다.
function readCycle(pages: readonly string[], month: number, into: SourceReadings) {
  const targets: Array<[IndicatorName, RegExp]> = [
    ["경기동행지수", /^동행지수\s*순환변동치/],
    ["경기선행지수", /^선행지수\s*순환변동치/],
  ];
  pages.forEach((text, index) => {
    const rows = lines(text);
    // 머리글: ’26.4월 5월 6월p 7월p 8월p 또는 ’26.1월 2월 ... 8월p
    const header = rows.find((line) => /^’\d{2}\.\d{1,2}월(\s+\d{1,2}월p?)+$/.test(line));
    const headerMonth = header ? /(\d{1,2})월p?\s*$/.exec(header)?.[1] : undefined;
    if (headerMonth === undefined || Number(headerMonth) !== month) return;
    for (const [name, pattern] of targets) {
      rows.forEach((line, i) => {
        if (!pattern.test(line)) return;
        const diff = rows[i + 1] ?? "";
        if (!/^[․·ㆍ]?\s*전월차\s*\(\s*p\s*\)/.test(diff)) return;
        const raw = lastNumber(diff.replace(/\(\s*p\s*\)/, ""));
        if (raw) push(into, name, "전월차", reading(`${index + 1}쪽 ${name === "경기동행지수" ? "동행" : "선행"}지수 순환변동치 표`, index + 1, raw));
      });
    }
  });
}

// 3) 본문 문장: "전월대비 1.3% 감소"의 숫자와 감소·증가 말로 부호를 정한다.
function signed(amount: string, word: string): string {
  return /감소|하락/.test(word) ? `-${amount}` : amount;
}

function readSentences(pages: readonly string[], into: SourceReadings) {
  pages.forEach((text, index) => {
    const flat = text.replace(/\s+/g, " ");
    const page = index + 1;
    for (const name of TABLE_NAMES) {
      const head = new RegExp(`\\(${name}\\)([^□]{0,500})`).exec(flat);
      if (!head) continue;
      const body = head[1];
      const monthly = /전월대비\s*(\d+(?:\.\d+)?)%\s*(증가|감소)/.exec(body);
      if (monthly) push(into, name, "전월비", reading(`${page}쪽 본문 문장`, page, signed(monthly[1], monthly[2])));
      const yearly = /전년동월대비(?:로는)?[^○]*?(\d+(?:\.\d+)?)%\s*(증가|감소)/.exec(monthly ? body.slice((monthly.index ?? 0) + monthly[0].length) : body);
      if (yearly) push(into, name, "전년동월비", reading(`${page}쪽 본문 문장`, page, signed(yearly[1], yearly[2])));
    }
    for (const [name, label] of [["경기동행지수", "동행종합지수"], ["경기선행지수", "선행종합지수"]] as const) {
      const head = new RegExp(`\\(${label} 순환변동치\\)([^□]{0,300})`).exec(flat);
      const diff = head ? /전월대비\s*(\d+(?:\.\d+)?)p\s*(상승|하락)/.exec(head[1]) : null;
      if (diff) push(into, name, "전월차", reading(`${page}쪽 본문 문장`, page, signed(diff[1], diff[2])));
    }
  });
}

/**
 * 보도자료 쪽별 글자에서 AI와 상관없이 수치를 다시 읽는다. month는 기준 달의 월(예: 2026-08이면 8)이고,
 * 표의 맨 아래(오른쪽) 달이 이 달과 다르면 그 표는 쓰지 않는다. (다른 달 숫자를 가져오는 착각을 막기 위함)
 */
export function readSources(pages: readonly string[], period: string | null): SourceReadings {
  const readings: SourceReadings = {};
  const month = period ? Number(period.slice(5, 7)) : NaN;
  if (!Number.isInteger(month) || month < 1 || month > 12) return readings;
  readSmallTables(pages, month, readings);
  readSummaryTable(pages, month, readings);
  readCycle(pages, month, readings);
  // 본문 문장은 그 자료가 말하는 달(제목의 달)이 기준 달과 같을 때만 쓴다.
  if (derivePeriod(pages) === period) readSentences(pages, readings);
  return readings;
}

/** 지금 표에 있는 값(AI가 읽었거나 담당자가 고친 값)을 규칙으로 읽은 값들과 맞춰 본다. */
export function crossCheck(
  name: IndicatorName,
  comparison: Comparison,
  current: number | null,
  readings: SourceReadings,
): CrossCheckResult {
  const found = readings[key(name, comparison)] ?? [];
  if (current === null) {
    return found.length === 0
      ? { status: "확인 못 함", agree: 0, total: 0, detail: "값이 비어 있고, 다른 곳에서도 찾지 못했습니다." }
      : { status: "확인 못 함", agree: 0, total: found.length, detail: `값은 비어 있습니다. 문서의 ${found[0].where}에는 ${found[0].rawText}로 적혀 있습니다.` };
  }
  if (found.length === 0) {
    return { status: "확인 못 함", agree: 0, total: 0, detail: "다른 표나 본문에서 같은 수치를 찾지 못해 AI가 읽은 값만 있습니다. 원본과 직접 비교해 주세요." };
  }
  const same = found.filter((r) => Math.abs(r.value - current) < 1e-9);
  const different = found.filter((r) => Math.abs(r.value - current) >= 1e-9);
  if (different.length > 0) {
    const first = different[0];
    return {
      status: "불일치",
      agree: same.length,
      total: found.length,
      detail: `표의 값(${current})과 ${first.where}의 값(${first.rawText})이 다릅니다. 원본을 직접 확인해 주세요.`,
    };
  }
  return {
    status: "교차 확인",
    agree: same.length,
    total: found.length,
    detail: `${same.map((r) => r.where).join(", ")}에서 같은 값을 확인했습니다.`,
  };
}
