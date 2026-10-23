// Design Ref: §2.2 5단계 — 담당자가 붙여 넣은 작성본의 수치를 원자료와 대조한다. AI 없이 코드로만 하고, 작성본은 브라우저 밖으로 나가지 않는다.
// Plan SC: PLAN 4번 작업. 작성본에 적힌 숫자 중 "어느 지표의 전월비/전년동월비인지" 분명한 것만 원자료와 비교하고, 짐작이 필요한 것은 비교하지 않고 따로 알린다.

import { formatSigned, parseSigned } from "./growth";
import type {
  Comparison,
  Indicator,
  IndicatorName,
  SourceLocation,
} from "./indicators";

/** 대조 결과. 확인 불가는 틀렸다는 뜻이 아니라, 비교할 수 없어 사람이 봐야 한다는 뜻이다. */
export type CompareStatus = "일치" | "불일치" | "확인 불가";

/** 작성본에서 찾은 숫자 하나에 대한 대조 결과. */
export interface CompareFinding {
  status: CompareStatus;
  name: IndicatorName;
  comparison: Comparison;
  /** 작성본에 적힌 글자 그대로 (예: "△1.8%") */
  writtenText: string;
  /** 작성본 글자를 숫자로 읽은 값. 읽을 수 없으면 null */
  writtenValue: number | null;
  /** 원자료의 값. 비교할 수 없으면 null */
  sourceValue: number | null;
  /** 원자료에 적힌 글자 그대로. 직접 입력·빈칸이면 null */
  sourceText: string | null;
  /** 원자료 위치 */
  source: SourceLocation | null;
  /** 담당자가 읽을 설명 */
  message: string;
}

/** 어느 지표의 숫자인지 분명하지 않아 비교하지 않은 숫자. 범위 밖 통계(수출, 고용 등)도 여기에 들어올 수 있다. */
export interface UnlinkedNumber {
  /** 작성본에 적힌 글자 (예: "전월비 △4.8%") */
  text: string;
  /** 그 숫자가 들어 있던 문장 */
  sentence: string;
}

export interface CompareReport {
  findings: CompareFinding[];
  unlinked: UnlinkedNumber[];
}

// 작성본에서 지표를 가리키는 말. 같은 곳에서 겹치면 긴 말이 먼저 잡히도록 길이순으로 정렬해 쓴다.
const NAME_ALIASES: Record<IndicatorName, readonly string[]> = {
  전산업생산: ["전산업생산", "전산업 생산"],
  소매판매: ["소매판매"],
  설비투자: ["설비투자지수", "설비투자"],
  경기동행지수: ["경기동행지수", "동행지수"],
  경기선행지수: ["경기선행지수", "선행지수"],
};

// 비교 기준을 가리키는 말. 요약문은 "전년동월비"를 "전년비"로도 줄여 쓴다.
const COMPARISON_WORDS: ReadonlyArray<readonly [string, Comparison]> = [
  ["전년동월대비", "전년동월비"],
  ["전년동월비", "전년동월비"],
  ["전년대비", "전년동월비"],
  ["전년비", "전년동월비"],
  ["전월대비", "전월비"],
  ["전월비", "전월비"],
];

const aliasToName = new Map<string, IndicatorName>();
for (const [name, aliases] of Object.entries(NAME_ALIASES) as [IndicatorName, readonly string[]][]) {
  for (const alias of aliases) aliasToName.set(alias, name);
}
const wordToComparison = new Map(COMPARISON_WORDS);

const byLengthDesc = (a: string, b: string) => b.length - a.length;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const NAME_REGEX = new RegExp(
  `(${[...aliasToName.keys()].sort(byLengthDesc).map(escapeRegExp).join("|")})`,
  "g",
);

// 비교 기준 말 뒤에 오는 숫자. ▲·▼는 뜻이 모호해 읽지는 못하지만, 일부러 잡아서 "확인 불가"로 알려 준다.
// 숫자 바로 뒤에 한글·영문·숫자가 이어지면(예: "11.3만명") 퍼센트 증감률이 아니므로 잡지 않는다.
const COMPARISON_NUMBER_REGEX = new RegExp(
  `(${[...wordToComparison.keys()].sort(byLengthDesc).join("|")})\\s*` +
    `([△▲▼\\-−–－+＋]?\\s*\\d[\\d,]*(?:\\.\\d+)?\\s*(?:%p|%|p)?)(?![0-9가-힣A-Za-z]|\\.\\d)`,
  "g",
);

// 문장 끝의 마침표, 줄바꿈, 글머리 기호에서 문장을 나눈다. 숫자 사이의 소수점은 나누지 않는다.
const SENTENCE_SPLIT_REGEX = /(?<!\d)\.(?!\d)|[\n。▪•]/;

// 지표 이름과 비교 기준 말 사이에 올 수 있는 것: 공백, 괄호, 조사 한 글자
const NAME_GAP_REGEX = /^[\s(（]*[은는이가도의]?[\s(（]*$/;
// 한 지표의 둘째 숫자(", 전년비 …")가 같은 지표에 이어지는지 볼 때, 앞 숫자와 사이에 올 수 있는 것
const CHAIN_GAP_REGEX =
  /^[\s,·(（)）]*(?:(?:증가|감소|상승|하락|보합|확대|축소|둔화|개선|악화)[\s,·(（)）]*)?$/;

/** 비교하는 두 숫자가 같은지. 소수점 오차는 무시한다. */
function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

function judge(
  name: IndicatorName,
  comparison: Comparison,
  writtenText: string,
  indicators: readonly Indicator[],
): CompareFinding {
  const writtenValue = parseSigned(writtenText);
  const base = { name, comparison, writtenText, writtenValue };
  const noSource = { sourceValue: null, sourceText: null, source: null };

  const candidates = indicators.filter((i) => i.name === name && i.comparison === comparison);
  if (candidates.length === 0) {
    return {
      ...base,
      ...noSource,
      status: "확인 불가",
      message: `${name} ${comparison}에 해당하는 원자료 수치가 없어 비교할 수 없습니다.`,
    };
  }
  if (candidates.length > 1) {
    return {
      ...base,
      ...noSource,
      status: "확인 불가",
      message: `${name} ${comparison}에 해당하는 원자료 수치가 여러 개라 어느 것과 비교할지 알 수 없습니다.`,
    };
  }

  const indicator = candidates[0];
  const source = {
    sourceValue: indicator.value,
    sourceText: indicator.rawText,
    source: indicator.source,
  };
  if (indicator.value === null) {
    return {
      ...base,
      ...source,
      status: "확인 불가",
      message: `${name} ${comparison}의 원자료 수치가 비어 있어 비교할 수 없습니다.`,
    };
  }
  if (writtenValue === null) {
    return {
      ...base,
      ...source,
      status: "확인 불가",
      message: `작성본의 "${writtenText}"는 숫자로 읽을 수 없어(뜻이 모호한 부호 등) 비교하지 않았습니다.`,
    };
  }

  const sourceLabel = indicator.rawText ?? formatSigned(indicator.value, "%");
  if (sameNumber(writtenValue, indicator.value)) {
    return {
      ...base,
      ...source,
      status: "일치",
      message: `${name} ${comparison}: 작성본 ${writtenText}는 원자료 ${sourceLabel}와 같습니다.`,
    };
  }
  return {
    ...base,
    ...source,
    status: "불일치",
    message: `${name} ${comparison}: 작성본은 ${writtenText}인데 원자료는 ${sourceLabel}입니다.`,
  };
}

/** 대조 결과를 상태별로 센다. */
export function summarizeFindings(findings: readonly CompareFinding[]): Record<CompareStatus, number> {
  const summary: Record<CompareStatus, number> = { 일치: 0, 불일치: 0, "확인 불가": 0 };
  for (const finding of findings) summary[finding.status] += 1;
  return summary;
}

/**
 * 작성본의 수치를 원자료와 대조한다.
 *
 * 규칙 (짐작이 필요한 숫자는 비교하지 않고 unlinked로 알린다):
 * 1. 작성본을 문장으로 나눈다.
 * 2. "전월비", "전월대비", "전년비", "전년동월비" 같은 비교 기준 말 바로 뒤의 퍼센트·포인트 숫자만 대상으로 한다.
 * 3. 그 숫자 바로 앞(공백·괄호·조사만 사이에 있음)에 지표 이름이 있거나, 같은 괄호 안에서 앞 숫자가 그 지표에 이어질 때만 그 지표의 숫자로 본다.
 * 4. 그렇지 않으면(광공업, 서비스업, 수출, 고용 등) 비교하지 않고 unlinked에 담는다.
 * 5. 연결된 숫자는 원자료 수치(지표·비교 기준이 같은 것)와 숫자로 비교한다. 표기(△, -, %)가 달라도 값이 같으면 일치로 본다.
 *
 * @param draft 담당자가 붙여 넣은 작성본
 * @param indicators 이번 달 원자료 수치. 같은 지표·비교 기준이 둘이 되지 않게 이번 달 것만 넘긴다.
 */
export function compareDraft(draft: string, indicators: readonly Indicator[]): CompareReport {
  const findings: CompareFinding[] = [];
  const unlinked: UnlinkedNumber[] = [];

  for (const rawSentence of draft.split(SENTENCE_SPLIT_REGEX)) {
    const sentence = rawSentence.trim();
    if (sentence === "") continue;

    const names = [...sentence.matchAll(NAME_REGEX)].map((m) => ({
      name: aliasToName.get(m[1]) as IndicatorName,
      end: (m.index ?? 0) + m[0].length,
    }));

    let previous: { name: IndicatorName | null; end: number } | null = null;
    for (const match of sentence.matchAll(COMPARISON_NUMBER_REGEX)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const comparison = wordToComparison.get(match[1]) as Comparison;
      const writtenText = match[2].trim();

      let linked: IndicatorName | null = null;
      const nameBefore = names.filter((n) => n.end <= start).at(-1);
      if (nameBefore && NAME_GAP_REGEX.test(sentence.slice(nameBefore.end, start))) {
        linked = nameBefore.name;
      } else if (previous?.name && CHAIN_GAP_REGEX.test(sentence.slice(previous.end, start))) {
        linked = previous.name;
      }
      previous = { name: linked, end };

      if (linked === null) {
        unlinked.push({ text: `${match[1]} ${writtenText}`, sentence });
      } else {
        findings.push(judge(linked, comparison, writtenText, indicators));
      }
    }
  }

  return { findings, unlinked };
}
