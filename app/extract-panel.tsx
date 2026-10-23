"use client";

// Design Ref: §1 화면 구성 ①② — 파일을 올리면 브라우저가 글자를 꺼내고, 서버가 AI로 수치를 찾아 표로 보여 준다.
// Plan SC: PLAN 9번 작업. 못 뽑은 칸은 빈칸으로 두고 담당자가 직접 입력하며, 고친 값은 "직접 입력"으로 표시한다.

import { useEffect, useMemo, useRef, useState } from "react";
import { compareDraft, summarizeFindings, type CompareStatus } from "../lib/compare";
import { derivePeriod, EXPECTED_INDICATORS } from "../lib/extract";
import type { Indicator, IndicatorStatus } from "../lib/indicators";
import { extractPdfPages, looksLikePdf } from "../lib/pdf";
import { blankTable, buildTable, formatPeriod, formatSource, initialText, rowKey } from "../lib/table";
import type { ValidationStatus } from "../lib/validate";
import { withDraftMark } from "../lib/summary";
import { selectPassed, summarize, verifyTable } from "../lib/verify";
import { button, card, heading, hint, lockedCard, primaryButton, stepNumber } from "./ui";

type Phase =
  | { kind: "idle" }
  | { kind: "reading" } // 브라우저가 PDF에서 글자를 꺼내는 중
  | { kind: "asking" } // 서버가 AI로 수치를 찾는 중
  | { kind: "done" }
  | { kind: "error"; message: string };

interface ExtractResponse {
  period: string | null;
  indicators: Indicator[];
  warnings: string[];
}

const VERDICT_STYLE: Record<ValidationStatus, string> = {
  오류: "bg-red-500/10 text-red-700 dark:text-red-400",
  "검증 불가": "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  통과: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

const COMPARE_STYLE: Record<CompareStatus, string> = {
  불일치: "bg-red-500/10 text-red-700 dark:text-red-400",
  "확인 불가": "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  일치: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

const STATUS_STYLE: Record<IndicatorStatus, string> = {
  추출됨: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  빈칸: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  "직접 입력": "bg-sky-500/10 text-sky-700 dark:text-sky-400",
};

function isExtractResponse(value: unknown): value is ExtractResponse {
  const body = value as Partial<ExtractResponse> | null;
  return !!body && Array.isArray(body.indicators) && Array.isArray(body.warnings);
}

export default function ExtractPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [originals, setOriginals] = useState<Indicator[] | null>(null);
  const [period, setPeriod] = useState<string | null>(null);
  // 자동으로 기준 달을 알 수 없을 때(추출 실패) 담당자가 직접 적는 달. 예: 2026-08
  const [manualPeriod, setManualPeriod] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  // 작성본은 이 화면의 상태로만 두고, 서버·AI·브라우저 저장소 어디로도 보내지 않는다.
  const [draft, setDraft] = useState("");
  const [comparedDraft, setComparedDraft] = useState<string | null>(null);
  // 종합평가 초안. 담당자가 고칠 수 있도록 글 상태로 둔다.
  const [summaryText, setSummaryText] = useState("");
  const [summaryBasis, setSummaryBasis] = useState<string | null>(null); // 초안을 만들 때 쓴 수치 (표가 바뀌었는지 알아보는 용도)
  const [summaryPhase, setSummaryPhase] = useState<"idle" | "busy" | { error: string }>("idle");
  const [copyMessage, setCopyMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const effectivePeriod = period ?? (/^\d{4}-(0[1-9]|1[0-2])$/.test(manualPeriod.trim()) ? manualPeriod.trim() : null);
  const busy = phase.kind === "reading" || phase.kind === "asking";
  const table = useMemo(() => (originals ? buildTable(originals, texts) : null), [originals, texts]);

  function chooseFile(next: File | null) {
    setFile(next);
    setPhase({ kind: "idle" });
    setOriginals(null);
    setPeriod(null);
    setManualPeriod("");
    setWarnings([]);
    setTexts({});
    setComparedDraft(null);
    setSummaryText("");
    setSummaryBasis(null);
    setSummaryPhase("idle");
  }

  // 초안을 복사한다. 맨 위에 "초안" 표시 한 줄이 붙고, 복사한 글은 어디에도 저장하지 않는다.
  async function copySummary() {
    try {
      await navigator.clipboard.writeText(withDraftMark(summaryText));
      setCopyMessage({ ok: true, text: "복사했습니다. 한글에 붙여 넣어 주세요." });
    } catch {
      setCopyMessage({ ok: false, text: "복사하지 못했습니다. 초안 글을 직접 선택해서 복사해 주세요." });
    }
    setTimeout(() => setCopyMessage(null), 4000);
  }

  async function makeSummary() {
    if (!effectivePeriod || summaryItems.length === 0) return;
    setSummaryPhase("busy");
    try {
      const response = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: effectivePeriod, items: summaryItems }),
      });
      const body: unknown = await response.json().catch(() => null);
      const text = (body as { text?: unknown } | null)?.text;
      if (!response.ok || typeof text !== "string") {
        const message = (body as { error?: string } | null)?.error;
        setSummaryPhase({ error: message ?? "초안을 만드는 중 문제가 생겼습니다. 잠시 뒤에 다시 시도해 주세요." });
        return;
      }
      setSummaryText(text);
      setSummaryBasis(summaryKey);
      setSummaryPhase("idle");
    } catch {
      setSummaryPhase({ error: "서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요." });
    }
  }

  // 자동 추출에 실패해도 담당자가 보도자료를 보고 직접 입력할 수 있게 빈 표를 연다.
  function failWithManualTable(message: string, pages: string[] | null) {
    const knownPeriod = pages ? derivePeriod(pages) : null;
    setOriginals(blankTable(knownPeriod));
    setPeriod(knownPeriod);
    setWarnings(["자동으로 수치를 찾지 못해 빈 표를 열었습니다. 보도자료를 보고 직접 입력해 주세요."]);
    setPhase({ kind: "error", message });
  }

  async function extract() {
    if (!file) return;
    autoSummaryDone.current = false;
    setOriginals(null);
    setPeriod(null);
    setManualPeriod("");
    setTexts({});
    setWarnings([]);
    setComparedDraft(null);
    setSummaryText("");
    setSummaryBasis(null);
    setSummaryPhase("idle");
    setPhase({ kind: "reading" });

    let pages: string[];
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!looksLikePdf(bytes)) {
        setPhase({ kind: "error", message: "PDF 파일이 아닙니다. (한글 파일은 아직 지원하지 않습니다.)" });
        return;
      }
      pages = (await extractPdfPages(bytes)).pages;
    } catch {
      failWithManualTable("PDF에서 글자를 꺼내지 못했습니다. 파일이 손상되었거나 암호가 걸려 있을 수 있습니다.", null);
      return;
    }
    if (pages.every((page) => page.trim() === "")) {
      failWithManualTable("PDF에 글자가 없습니다. 그림으로만 된 스캔본일 수 있습니다.", null);
      return;
    }

    setPhase({ kind: "asking" });
    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !isExtractResponse(body)) {
        const message = (body as { error?: string } | null)?.error;
        failWithManualTable(message ?? "수치를 찾는 중 문제가 생겼습니다. 잠시 뒤에 다시 시도해 주세요.", pages);
        return;
      }
      setOriginals(body.indicators);
      setPeriod(body.period);
      setWarnings(body.warnings);
      setPhase({ kind: "done" });
    } catch {
      failWithManualTable("서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.", pages);
    }
  }

  const rows: Indicator[] | null = table ? table.indicators : null;
  const verification = useMemo(
    () => (originals && table ? verifyTable(originals, table.indicators, table.errors) : null),
    [originals, table],
  );
  const summary = verification ? summarize(verification) : null;
  // 표의 값을 고치면 대조 결과도 바로 바뀐다. (작성본은 버튼을 누른 시점의 글을 쓴다.)
  const comparison = useMemo(
    () => (comparedDraft !== null && table ? compareDraft(comparedDraft, table.indicators) : null),
    [comparedDraft, table],
  );
  const compareSummary = comparison ? summarizeFindings(comparison.findings) : null;
  const compareProblems = (comparison?.findings ?? [])
    .filter((finding) => finding.status !== "일치")
    .sort((a, b) => Number(b.status === "불일치") - Number(a.status === "불일치"));
  const compareMatches = (comparison?.findings ?? []).filter((finding) => finding.status === "일치");
  // 종합평가 초안에는 검증을 통과한 수치만 쓴다.
  const passedRows = useMemo(
    () => (table && verification ? selectPassed(table.indicators, verification) : []),
    [table, verification],
  );
  const summaryItems = passedRows.map((row) => ({ name: row.name, comparison: row.comparison, unit: row.unit, value: row.value }));
  const summaryKey = JSON.stringify(summaryItems);
  const excludedCount = (table?.indicators.length ?? 0) - passedRows.length;
  const summaryBusy = summaryPhase === "busy";
  // 수치를 찾으면 초안을 한 번 자동으로 만든다. (검증을 통과한 수치가 있을 때만. 그 뒤로는 담당자가 버튼으로 다시 만든다.)
  const autoSummaryDone = useRef(false);
  useEffect(() => {
    if (phase.kind !== "done" || autoSummaryDone.current) return;
    if (!effectivePeriod || summaryItems.length === 0 || summaryText !== "" || summaryPhase !== "idle") return;
    // 효과 안에서 바로 상태를 바꾸지 않고 한 박자 뒤에 시작한다.
    const timer = setTimeout(() => {
      autoSummaryDone.current = true;
      void makeSummary();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind, effectivePeriod, summaryKey]);
  const problems = verification?.filter((item) => item.result.status !== "통과") ?? [];
  const passed = verification?.filter((item) => item.result.status === "통과") ?? [];
  // 오류를 먼저, 그다음 검증 불가 순서로 보여 준다.
  problems.sort((a, b) => Number(b.result.status === "오류") - Number(a.result.status === "오류"));

  return (
    <>
      {/* ① 자료 올리기 */}
      <section aria-labelledby="step1" className={card}>
        <h2 id="step1" className={heading}>
          <span className={stepNumber}>1</span>자료 올리기
        </h2>
        <p className={hint}>산업활동동향 보도자료 PDF 파일을 선택하세요. (한글 파일은 아직 지원하지 않습니다.)</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="file"
            accept=".pdf,application/pdf"
            disabled={busy}
            aria-label="산업활동동향 보도자료 파일"
            onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            className="min-w-0 flex-1 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-surface-strong file:px-5 file:py-2.5 file:text-sm file:font-semibold"
          />
          <button type="button" onClick={extract} disabled={!file || busy} className={primaryButton}>
            {busy ? "찾는 중…" : "수치 추출하기"}
          </button>
        </div>
        <div aria-live="polite" className="mt-3 text-sm">
          {phase.kind === "reading" && (
            <p className="text-muted">
              PDF에서 글자를 읽는 중입니다. 쪽이 많으면 10~20초 걸릴 수 있습니다. 파일은 이 컴퓨터 밖으로 나가지 않습니다.
            </p>
          )}
          {phase.kind === "asking" && (
            <p className="text-muted">수치 표가 있는 쪽을 AI로 읽는 중입니다…</p>
          )}
          {phase.kind === "error" && (
            <p role="alert" className="rounded-2xl bg-red-500/10 px-4 py-3 text-red-700 dark:text-red-400">
              {phase.message}
            </p>
          )}
        </div>
      </section>

      {/* ② 추출한 수치 */}
      <section
        aria-labelledby="step2"
        className={rows ? card : lockedCard}
      >
        <h2 id="step2" className={heading}>
          <span className={stepNumber}>2</span>추출한 수치
          {effectivePeriod && <span className="text-sm font-normal text-muted">{formatPeriod(effectivePeriod)} 자료</span>}
        </h2>
        <p className={hint}>
          {rows
            ? "빈칸은 직접 입력하고, 잘못 읽힌 값은 고쳐 주세요. 예: -1.3 또는 △1.3"
            : "추출하지 못한 칸은 비어 있습니다. 직접 입력해 주세요."}
        </p>

        {rows && period === null && (
          <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span>기준 달을 적어 주세요 (초안에 쓰입니다)</span>
            <input
              type="text"
              inputMode="numeric"
              value={manualPeriod}
              onChange={(event) => setManualPeriod(event.target.value)}
              placeholder="예: 2026-08"
              aria-label="기준 달"
              className="w-32 rounded-xl border border-line bg-transparent px-3 py-1.5"
            />
          </label>
        )}

        {warnings.length > 0 && (
          <ul className="mt-3 list-disc rounded-2xl bg-amber-500/10 py-3 pl-8 pr-4 text-sm text-amber-800 dark:text-amber-300">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="py-2 pr-3 font-medium">지표</th>
                <th className="py-2 pr-3 font-medium">비교 기준</th>
                <th className="py-2 pr-3 font-medium">값</th>
                <th className="py-2 pr-3 font-medium">단위</th>
                <th className="py-2 pr-3 font-medium">원자료 위치</th>
                <th className="py-2 font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {rows && originals
                ? rows.map((row, index) => {
                    const key = rowKey(row);
                    const error = table?.errors[key];
                    return (
                      <tr key={key} className="border-b border-line align-top last:border-0">
                        <td className="py-2 pr-3">{row.name}</td>
                        <td className="py-2 pr-3">{row.comparison}</td>
                        <td className="py-2 pr-3">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={texts[key] ?? initialText(originals[index])}
                            onChange={(event) => setTexts((prev) => ({ ...prev, [key]: event.target.value }))}
                            aria-label={`${row.name} ${row.comparison} 값`}
                            aria-invalid={error ? true : undefined}
                            placeholder="직접 입력"
                            className="w-28 rounded-xl border border-line bg-transparent px-3 py-1.5"
                          />
                          {error && (
                            <p role="alert" className="mt-1 max-w-48 text-xs text-red-700 dark:text-red-400">
                              {error}
                            </p>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-muted">{row.unit}</td>
                        <td className="py-2 pr-3 text-muted">{formatSource(row.source)}</td>
                        <td className="py-2">
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[row.status]}`}>
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                : EXPECTED_INDICATORS.map((row) => (
                    <tr
                      key={`${row.name}-${row.comparison}`}
                      className="border-b border-line last:border-0"
                    >
                      <td className="py-2 pr-3">{row.name}</td>
                      <td className="py-2 pr-3">{row.comparison}</td>
                      <td className="py-2 pr-3 text-muted/60">—</td>
                      <td className="py-2 pr-3 text-muted">{row.unit}</td>
                      <td className="py-2 pr-3 text-muted/60">—</td>
                      <td className="py-2 text-muted">대기</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ③ 오류 검증 결과 */}
      <section aria-labelledby="step3" className={verification ? card : lockedCard}>
        <h2 id="step3" className={heading}>
          <span className={stepNumber}>3</span>오류 검증 결과
        </h2>
        <p className={hint}>원자료와 다른 수치가 있으면 어디가 다른지, 몇 쪽 어느 표인지 함께 보여 드립니다.</p>

        {verification && summary ? (
          <div className="mt-4" aria-live="polite">
            <p className="text-sm font-medium">
              <span className="text-red-700 dark:text-red-400">오류 {summary.오류}건</span>
              <span className="mx-2 text-muted/50">·</span>
              <span className="text-amber-700 dark:text-amber-400">확인 불가 {summary["검증 불가"]}건</span>
              <span className="mx-2 text-muted/50">·</span>
              <span className="text-emerald-700 dark:text-emerald-400">통과 {summary.통과}건</span>
            </p>

            {problems.length === 0 ? (
              <p className="mt-3 rounded-2xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
                모든 수치가 원자료와 같습니다.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {problems.map((item) => (
                  <li
                    key={`${item.name}-${item.comparison}-${item.check}`}
                    className="rounded-2xl bg-surface-strong px-4 py-3.5 text-[15px]"
                  >
                    <p className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${VERDICT_STYLE[item.result.status]}`}>
                        {item.result.status}
                      </span>
                      <span className="font-medium">
                        {item.name} {item.comparison}
                      </span>
                      <span className="text-xs text-muted">{item.check}</span>
                    </p>
                    <p className="mt-1">{item.result.message}</p>
                    <p className="mt-1 text-xs text-muted">
                      원자료 위치: {formatSource(item.result.source)}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {passed.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-muted">통과한 {passed.length}건 보기</summary>
                <ul className="mt-2 flex flex-col gap-1 pl-1 text-muted">
                  {passed.map((item) => (
                    <li key={`${item.name}-${item.comparison}-${item.check}`}>
                      {item.name} {item.comparison} — {item.result.message} ({formatSource(item.result.source)})
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {!verification.some((item) => item.check === "증감률 다시 계산") && (
              <p className="mt-3 text-xs text-muted">
                지수 값을 아직 가져오지 않아 증감률을 다시 계산하는 검증은 하지 않습니다. 지금은 원자료에서 읽은 글자와 맞는지만 확인합니다.
              </p>
            )}
          </div>
        ) : (
          <p className="mt-4 rounded-2xl bg-surface-strong px-4 py-3.5 text-[15px] text-muted">
            아직 검증한 내용이 없습니다.
          </p>
        )}
      </section>

      {/* ④ 작성본 대조 */}
      <section aria-labelledby="step4" className={rows ? card : lockedCard}>
        <h2 id="step4" className={heading}>
          <span className={stepNumber}>4</span>작성본 대조
        </h2>
        <p className={hint}>
          한글에 쓴 작성본을 붙여 넣으면 원자료와 숫자를 맞춰 봅니다. 붙여 넣은 내용은 이 화면 안에서만 쓰이고 서버나 AI로 보내지 않으며 저장하지도 않습니다.
        </p>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={!rows}
          rows={6}
          spellCheck={false}
          autoComplete="off"
          placeholder={
            rows
              ? "한글에 쓴 작성본을 여기에 붙여 넣으세요. 예: 소매판매(전월비 △1.8%, 전년비 △0.3%)"
              : "먼저 1번 칸에서 수치를 추출해 주세요."
          }
          aria-label="작성본"
          className="mt-4 w-full resize-y rounded-2xl border border-line bg-transparent p-4 text-[15px] leading-6 disabled:opacity-60"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setComparedDraft(draft)}
            disabled={!rows || draft.trim() === ""}
            className={button}
          >
            대조하기
          </button>
          {comparedDraft !== null && comparedDraft !== draft && (
            <span className="text-xs text-muted">작성본이 바뀌었습니다. 다시 대조해 주세요.</span>
          )}
        </div>

        {comparison && compareSummary && (
          <div className="mt-4" aria-live="polite">
            <p className="text-sm font-medium">
              <span className="text-red-700 dark:text-red-400">불일치 {compareSummary.불일치}건</span>
              <span className="mx-2 text-muted/50">·</span>
              <span className="text-amber-700 dark:text-amber-400">확인 불가 {compareSummary["확인 불가"]}건</span>
              <span className="mx-2 text-muted/50">·</span>
              <span className="text-emerald-700 dark:text-emerald-400">일치 {compareSummary.일치}건</span>
              {comparison.unlinked.length > 0 && (
                <>
                  <span className="mx-2 text-muted/50">·</span>
                  <span className="text-muted">비교하지 않은 숫자 {comparison.unlinked.length}개</span>
                </>
              )}
            </p>

            {comparison.findings.length === 0 && comparison.unlinked.length === 0 && (
              <p className="mt-3 rounded-2xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
                작성본에서 비교할 수치를 찾지 못했습니다. 지표 이름 바로 뒤에 &quot;전월비 △1.8%&quot;처럼 비교 기준과 숫자가 적힌 문장을 붙여 넣어 주세요.
              </p>
            )}

            {compareProblems.length > 0 && (
              <ul className="mt-3 flex flex-col gap-2">
                {compareProblems.map((finding, index) => (
                  <li
                    key={`${finding.name}-${finding.comparison}-${index}`}
                    className="rounded-2xl bg-surface-strong px-4 py-3.5 text-[15px]"
                  >
                    <p className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${COMPARE_STYLE[finding.status]}`}>
                        {finding.status}
                      </span>
                      <span className="font-medium">
                        {finding.name} {finding.comparison}
                      </span>
                      <span className="text-xs text-muted">작성본 {finding.writtenText}</span>
                    </p>
                    <p className="mt-1">{finding.message}</p>
                    <p className="mt-1 text-xs text-muted">
                      원자료 위치: {formatSource(finding.source)}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {compareMatches.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-muted">일치한 {compareMatches.length}건 보기</summary>
                <ul className="mt-2 flex flex-col gap-1 pl-1 text-muted">
                  {compareMatches.map((finding, index) => (
                    <li key={`${finding.name}-${finding.comparison}-${index}`}>
                      {finding.name} {finding.comparison} — 작성본 {finding.writtenText} ({formatSource(finding.source)})
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {comparison.unlinked.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-muted">
                  비교하지 않은 숫자 {comparison.unlinked.length}개 보기
                </summary>
                <p className="mt-2 text-xs text-muted">
                  어느 지표의 숫자인지 분명하지 않아 짐작하지 않고 비교하지 않았습니다. 광공업·서비스업·수출·고용 같은 이번 범위 밖 통계도 여기에 들어옵니다.
                </p>
                <ul className="mt-2 flex flex-col gap-1 pl-1 text-muted">
                  {comparison.unlinked.map((item, index) => (
                    <li key={`${item.text}-${index}`}>
                      {item.text} <span className="text-xs text-muted">— {item.sentence.slice(0, 40)}…</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>

      {/* ⑤ 종합평가 초안 */}
      <section aria-labelledby="step5" className={passedRows.length > 0 ? card : lockedCard}>
        <h2 id="step5" className={heading}>
          <span className={stepNumber}>5</span>종합평가 초안
          <span className="rounded-full border border-amber-600/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
            초안
          </span>
        </h2>
        <p className={hint}>
          검증을 통과한 수치로만 문장을 만듭니다. 담당자가 확인하기 전에는 확정본이 아닙니다.
        </p>
        <p className="mt-1 text-xs text-muted">
          AI에는 통과한 수치(지표 이름과 숫자)와 기준 달만 보냅니다. 작성본과 PDF 글자는 보내지 않습니다.
        </p>

        {table && (
          <p className="mt-3 text-sm text-muted">
            검증을 통과한 수치 {passedRows.length}개로 만듭니다.
            {excludedCount > 0 && ` (오류·확인 불가 ${excludedCount}개는 제외)`}
          </p>
        )}

        <textarea
          value={summaryText}
          onChange={(event) => setSummaryText(event.target.value)}
          rows={7}
          placeholder="수치를 찾으면 초안이 자동으로 나옵니다. 나온 뒤에는 직접 고치거나 다시 만들 수 있습니다. 나온 뒤에는 직접 고칠 수 있습니다."
          aria-label="종합평가 초안"
          className="mt-3 w-full resize-y rounded-2xl border border-line bg-transparent p-4 text-[15px] leading-6"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2" aria-live="polite">
          <button
            type="button"
            onClick={makeSummary}
            disabled={passedRows.length === 0 || !effectivePeriod || summaryBusy}
            className={primaryButton}
          >
            {summaryBusy ? "만드는 중…" : summaryText ? "초안 다시 만들기" : "초안 만들기"}
          </button>
          <button type="button" onClick={copySummary} disabled={summaryText.trim() === ""} className={button}>
            복사
          </button>
          {copyMessage && (
            <span role="status" className={`text-xs ${copyMessage.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
              {copyMessage.text}
            </span>
          )}
          {summaryText && summaryBasis !== null && summaryBasis !== summaryKey && (
            <span className="text-xs text-amber-700 dark:text-amber-400">
              표의 수치가 바뀌었습니다. 초안을 다시 만들어 주세요.
            </span>
          )}
        </div>
        {typeof summaryPhase === "object" && (
          <p role="alert" className="mt-3 rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-400">
            {summaryPhase.error}
          </p>
        )}
      </section>
    </>
  );
}
