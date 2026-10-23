"use client";

// 지표 하나의 최근 다섯 달 흐름 그래프. 막대(전월비·전월차)와 선(전년동월비)을 한 그림에 그린다.
// 흑백으로 그려 인쇄하거나 한글(HWP)에 붙여도 잘 보이게 했다. 값은 보도자료 표에 적힌 그대로다.

import { useRef, useState } from "react";
import { formatSigned } from "../lib/growth";
import type { Series } from "../lib/series";

const W = 360;
const H = 250;
const PAD = { top: 38, right: 16, bottom: 52, left: 16 };

function niceRange(values: number[]): { min: number; max: number } {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const pad = span * 0.18;
  return { min: lo < 0 ? lo - pad : 0, max: hi > 0 ? hi + pad : 0 };
}

export default function IndicatorChart({ series }: { series: Series }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { labels, primary, secondary } = series;
  const suffix = series.unit;
  const { min, max } = niceRange([...primary, ...(secondary ?? [])]);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + ((max - v) / (max - min || 1)) * innerH;
  const slot = innerW / labels.length;
  const x = (i: number) => PAD.left + slot * i + slot / 2;
  const barW = Math.min(34, slot * 0.5);
  const zeroY = y(0);
  const title = `${series.name} 최근 ${labels.length}개월`;

  async function savePng() {
    const svg = svgRef.current;
    if (!svg) return;
    try {
      const xml = new XMLSerializer().serializeToString(svg);
      const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("이미지를 만들지 못했습니다."));
        image.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = W * 3;
      canvas.height = H * 3;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("이미지를 만들지 못했습니다.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const link = document.createElement("a");
      link.download = `${series.name}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      setMessage(null);
    } catch {
      setMessage("그림 저장에 실패했습니다. 화면을 캡처해 주세요.");
    }
  }

  const line = secondary ? secondary.map((v, i) => `${x(i)},${y(v)}`).join(" ") : null;

  return (
    <figure className="rounded-2xl border border-line p-4">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{title}</span>
        <span className="text-xs text-muted">단위: {suffix === "%" ? "%, 전월 대비 막대 · 전년동월 대비 선" : "p, 전월차"}</span>
      </figcaption>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${title}. ${labels.map((l, i) => `${l} ${series.primaryLabel} ${formatSigned(primary[i])}${suffix}`).join(", ")}`} xmlns="http://www.w3.org/2000/svg" className="mt-2 block h-auto w-full">
        <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
        <line x1={PAD.left} x2={W - PAD.right} y1={zeroY} y2={zeroY} stroke="#000" strokeWidth="1" />
        {primary.map((v, i) => {
          const top = Math.min(y(v), zeroY);
          const height = Math.max(1, Math.abs(y(v) - zeroY));
          const labelY = v >= 0 ? top - 5 : top + height + 12;
          return (
            <g key={labels[i]}>
              <rect x={x(i) - barW / 2} y={top} width={barW} height={height} fill={v >= 0 ? "#000" : "#8a8a8a"} stroke="#000" strokeWidth="1" />
              <text x={x(i)} y={labelY} textAnchor="middle" fontSize="13" fontWeight="700" fill="#000" stroke="#fff" strokeWidth="3" paintOrder="stroke">
                {formatSigned(v)}
              </text>
              <text x={x(i)} y={H - PAD.bottom + 20} textAnchor="middle" fontSize="13" fill="#000">
                {labels[i]}
              </text>
            </g>
          );
        })}
        {line && secondary && (
          <g>
            <polyline points={line} fill="none" stroke="#000" strokeWidth="1.8" strokeDasharray="5 3" />
            {secondary.map((v, i) => (
              <g key={`s-${labels[i]}`}>
                <circle cx={x(i)} cy={y(v)} r="4" fill="#fff" stroke="#000" strokeWidth="1.8" />
                <text x={x(i)} y={y(v) - 10} textAnchor="middle" fontSize="12" fill="#000" stroke="#fff" strokeWidth="3" paintOrder="stroke">
                  {formatSigned(v)}
                </text>
              </g>
            ))}
          </g>
        )}
        <g fontSize="12" fill="#000">
          <rect x={PAD.left} y={H - 16} width="10" height="10" fill="#000" stroke="#000" />
          <text x={PAD.left + 14} y={H - 7}>
            {series.primaryLabel}
          </text>
          {secondary && series.secondaryLabel && (
            <>
              <line x1={PAD.left + 66} x2={PAD.left + 84} y1={H - 11} y2={H - 11} stroke="#000" strokeWidth="1.8" strokeDasharray="5 3" />
              <circle cx={PAD.left + 75} cy={H - 11} r="3.5" fill="#fff" stroke="#000" strokeWidth="1.5" />
              <text x={PAD.left + 90} y={H - 7}>
                {series.secondaryLabel}
              </text>
            </>
          )}
          <text x={W - PAD.right} y={H - 7} textAnchor="end" fill="#555">
            출처: 보도자료 {series.where.split(" ")[0]}
          </text>
        </g>
      </svg>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" onClick={savePng} className="text-sm font-semibold text-accent hover:underline">
          그림(PNG)으로 저장
        </button>
        {message && <span role="alert" className="text-xs text-red-700">{message}</span>}
      </div>
    </figure>
  );
}
