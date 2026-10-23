"use client";

// 확장 1단계 — 산업통상부 수출입동향 PDF를 올리면 브라우저가 부록 수출입 표의 새 달 한 줄을 채워 보여 준다.
// AI도 서버도 쓰지 않는다. 파일은 이 컴퓨터 밖으로 나가지 않고, 못 읽은 칸은 빈칸으로 둔다.

import { useState } from "react";
import { extractPdfPages, looksLikePdf } from "../lib/pdf";
import {
  formatTradeCell,
  parseTrade,
  toTabRow,
  TRADE_FIELDS,
  TRADE_REGIONS,
  type TradeLine,
  type TradeResult,
} from "../lib/trade";
import { button, card, heading, hint, primaryButton, stepNumber } from "./ui";

type Phase = { kind: "idle" } | { kind: "reading" } | { kind: "done" } | { kind: "error"; message: string };

export default function TradePanel() {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [result, setResult] = useState<TradeResult | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const busy = phase.kind === "reading";

  function chooseFile(next: File | null) {
    setFile(next);
    setResult(null);
    setPhase({ kind: "idle" });
  }

  async function read() {
    if (!file) return;
    setResult(null);
    setPhase({ kind: "reading" });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!looksLikePdf(bytes)) {
        setPhase({ kind: "error", message: "PDF 파일이 아닙니다. (한글 파일은 아직 지원하지 않습니다.)" });
        return;
      }
      const { pages } = await extractPdfPages(bytes);
      if (pages.every((page) => page.trim() === "")) {
        setPhase({ kind: "error", message: "PDF에 글자가 없습니다. 그림으로만 된 스캔본일 수 있습니다." });
        return;
      }
      setResult(parseTrade(pages));
      setPhase({ kind: "done" });
    } catch {
      setPhase({ kind: "error", message: "PDF에서 글자를 꺼내지 못했습니다. 파일이 손상되었거나 암호가 걸려 있을 수 있습니다." });
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMessage({ ok: true, text: "복사했습니다. 엑셀이나 한글 표에 붙여 넣어 주세요." });
    } catch {
      setMessage({ ok: false, text: "복사하지 못했습니다. 표의 숫자를 직접 선택해서 복사해 주세요." });
    }
    setTimeout(() => setMessage(null), 4000);
  }

  const lines: Array<{ label: string; line: TradeLine }> = result
    ? [{ label: "전체", line: result.total }, ...TRADE_REGIONS.map((region) => ({ label: region, line: result.regions[region] }))]
    : [];
  const blankCount = lines.reduce((sum, { line }) => sum + TRADE_FIELDS.filter((field) => line[field].value === null).length, 0);

  return (
    <section aria-labelledby="trade" className={card}>
      <h2 id="trade" className={heading}>
        <span className={stepNumber}>＋</span>부록 수출입 표 채우기
        {result?.period && <span className="text-sm font-normal text-muted">{Number(result.period.slice(0, 4))}년 {Number(result.period.slice(5))}월 자료</span>}
      </h2>
      <p className={hint}>
        산업통상부 「수출입동향」 보도자료 PDF를 올리면 부록 수출입(통관)·지역별 표의 새 달 한 줄을 채워 드립니다. AI를 쓰지 않고,
        파일은 이 컴퓨터 밖으로 나가지 않습니다.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="file"
          accept=".pdf,application/pdf"
          disabled={busy}
          aria-label="수출입동향 보도자료 파일"
          onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
          className="min-w-0 flex-1 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-surface-strong file:px-5 file:py-2.5 file:text-sm file:font-semibold"
        />
        <button type="button" onClick={read} disabled={!file || busy} className={primaryButton}>
          {busy ? "읽는 중…" : "표 채우기"}
        </button>
      </div>
      <div aria-live="polite" className="mt-3 text-sm">
        {phase.kind === "reading" && <p className="text-muted">PDF에서 글자를 읽는 중입니다. 10~20초 걸릴 수 있습니다.</p>}
        {phase.kind === "error" && (
          <p role="alert" className="rounded-2xl bg-red-500/10 px-4 py-3 text-red-700 dark:text-red-400">
            {phase.message}
          </p>
        )}
      </div>

      {result && (
        <div className="mt-4">
          {result.warnings.length > 0 && (
            <ul className="mb-4 flex list-disc flex-col gap-1 rounded-2xl bg-amber-500/10 py-3 pl-9 pr-4 text-sm text-amber-800 dark:text-amber-300">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          <p className="mb-3 text-sm text-muted">
            {blankCount === 0
              ? "모든 칸을 보도자료에서 읽었고, 서로 다른 표와 맞는지도 확인했습니다."
              : `${blankCount}칸은 확인하지 못해 비워 두었습니다. 직접 입력해 주세요.`}{" "}
            금액은 억불(보도자료의 백만 달러를 100으로 나누어 소수점 첫째 자리까지), 증가율은 전년동기비(%)입니다. 수출입차는 지역별로는
            수출에서 수입을 뺀 계산값이고, 읽은 값은 담당자가 확인하기 전에는 확정이 아닙니다.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-2 pr-3 font-medium">구분</th>
                  {TRADE_FIELDS.map((field) => (
                    <th key={field} className="px-2 py-2 text-right font-medium">
                      {field}
                    </th>
                  ))}
                  <th className="py-2 pl-3" />
                </tr>
              </thead>
              <tbody>
                {lines.map(({ label, line }) => (
                  <tr key={label} className="border-t border-line">
                    <th scope="row" className="py-2.5 pr-3 text-left font-semibold">
                      {label}
                    </th>
                    {TRADE_FIELDS.map((field) => {
                      const cell = line[field];
                      return (
                        <td
                          key={field}
                          title={cell.source ? `${cell.source.page}쪽 ${cell.source.table}${cell.derived ? " (계산)" : ""}` : "확인하지 못함"}
                          className={`px-2 py-2.5 text-right tabular-nums ${cell.value === null ? "text-red-700 dark:text-red-400" : ""}`}
                        >
                          {cell.value === null ? "빈칸" : formatTradeCell(cell.value)}
                        </td>
                      );
                    })}
                    <td className="py-2 pl-3 text-right">
                      <button type="button" onClick={() => copy(toTabRow(line))} className="text-sm font-semibold text-accent hover:underline">
                        복사
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => copy(lines.map(({ line }) => toTabRow(line)).join("\n"))} className={button}>
              다섯 줄 모두 복사
            </button>
            {message && (
              <span role="status" className={`text-xs ${message.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                {message.text}
              </span>
            )}
          </div>
          <p className="mt-3 text-xs text-muted">숫자 칸에 마우스를 올리면 보도자료의 쪽과 표 이름이 보입니다.</p>
        </div>
      )}
    </section>
  );
}
