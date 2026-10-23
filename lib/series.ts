// 그래프용 월별 흐름 — 보도자료의 작은 표에 이어 적힌 최근 다섯 달 수치를 그대로 읽는다. (AI를 쓰지 않는다.)
// 맨 오른쪽이 기준 달이 아니면 그래프를 만들지 않는다. (다른 달 표를 잘못 그리는 것을 막기 위함)

import { parseSigned } from "./growth";
import type { IndicatorName } from "./indicators";

export interface Series {
  name: IndicatorName;
  /** 막대로 그리는 값의 이름 (전월비 또는 전월차) */
  primaryLabel: string;
  /** 선으로 그리는 값의 이름. 없으면 null */
  secondaryLabel: string | null;
  unit: "%" | "p";
  /** 가로축 이름 (예: "’25.8", "5월") */
  labels: string[];
  primary: number[];
  secondary: number[] | null;
  /** 읽은 곳 (예: "6쪽 전산업생산 표") */
  where: string;
}

const NUM = String.raw`-?\d+(?:\.\d+)?`;
const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

const TABLE_NAMES = ["전산업생산", "소매판매", "설비투자"] as const;
const ROW = new RegExp(String.raw`^(’\d{2}\.\s*)?(\d{1,2})p?\s+(${NUM})\s+(${NUM})$`);

function readTable(pages: readonly string[], month: number): Series[] {
  const found: Series[] = [];
  pages.forEach((text, index) => {
    const rows = lines(text);
    for (const name of TABLE_NAMES) {
      for (let i = 0; i < rows.length - 2; i++) {
        if (rows[i] !== name || !/^전월비\s+전년동월비$/.test(rows[i + 1])) continue;
        const labels: string[] = [];
        const primary: number[] = [];
        const secondary: number[] = [];
        let lastMonth = NaN;
        for (let j = i + 2; j < rows.length; j++) {
          const match = ROW.exec(rows[j]);
          const a = match ? parseSigned(match[3]) : null;
          const b = match ? parseSigned(match[4]) : null;
          if (!match || a === null || b === null) break;
          labels.push(match[1] ? `${match[1].trim()}${match[2]}` : `${match[2]}월`);
          primary.push(a);
          secondary.push(b);
          lastMonth = Number(match[2]);
        }
        if (labels.length >= 2 && lastMonth === month && !found.some((s) => s.name === name)) {
          found.push({ name, primaryLabel: "전월비", secondaryLabel: "전년동월비", unit: "%", labels, primary, secondary, where: `${index + 1}쪽 ${name} 표` });
        }
      }
    }
  });
  return found;
}

function readCycle(pages: readonly string[], month: number): Series[] {
  const found: Series[] = [];
  pages.forEach((text, index) => {
    const rows = lines(text);
    const headerIndex = rows.findIndex((line) => /^’\d{2}\.\d{1,2}월(\s+\d{1,2}월p?)+$/.test(line));
    if (headerIndex < 0) return;
    const months = [...rows[headerIndex].matchAll(/(\d{1,2})월/g)].map((m) => Number(m[1]));
    if (months[months.length - 1] !== month) return;
    const labels = months.map((m, k) => (k === 0 ? `’${rows[headerIndex].slice(1, 3)}.${m}` : `${m}월`));
    for (const [name, pattern] of [
      ["경기동행지수", /^동행지수\s*순환변동치/],
      ["경기선행지수", /^선행지수\s*순환변동치/],
    ] as const) {
      const at = rows.findIndex((line, i) => i > headerIndex && pattern.test(line));
      const diff = at >= 0 ? rows[at + 1] : undefined;
      if (!diff || !/^[․·ㆍ]?\s*전월차\s*\(\s*p\s*\)/.test(diff)) continue;
      const numbers = (diff.replace(/\(\s*p\s*\)/, "").match(new RegExp(`(?<![\\d.])${NUM}(?![\\d.])`, "g")) ?? []).map((t) => parseSigned(t));
      if (numbers.length !== labels.length || numbers.some((n) => n === null) || found.some((s) => s.name === name)) continue;
      found.push({ name, primaryLabel: "전월차", secondaryLabel: null, unit: "p", labels, primary: numbers as number[], secondary: null, where: `${index + 1}쪽 ${name === "경기동행지수" ? "동행" : "선행"}지수 순환변동치 표` });
    }
  });
  return found;
}

/** 기준 달(예: 2026-08)까지 이어진 월별 흐름을 지표마다 읽는다. 못 읽은 지표는 빠진다. */
export function readSeries(pages: readonly string[], period: string | null): Series[] {
  const month = period ? Number(period.slice(5, 7)) : NaN;
  if (!Number.isInteger(month) || month < 1 || month > 12) return [];
  const order = ["전산업생산", "소매판매", "설비투자", "경기동행지수", "경기선행지수"];
  return [...readTable(pages, month), ...readCycle(pages, month)].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}
