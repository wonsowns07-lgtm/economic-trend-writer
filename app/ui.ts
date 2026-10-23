// 화면의 칸들이 함께 쓰는 모양(Tailwind 클래스). 여러 파일에서 같은 모양을 쓰려고 한곳에 모았다.
// 색은 globals.css의 기준 색(surface, muted, accent 등)을 쓰므로 밝은 화면·어두운 화면에서 자동으로 바뀐다.

export const card = "liquid-glass rounded-[1.25rem] p-6 sm:p-8";
export const lockedCard = `${card} opacity-50`;
export const heading = "flex flex-wrap items-center gap-3 text-xl font-bold tracking-tight";
export const stepNumber =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black text-sm font-bold text-white";
export const hint = "mt-2 text-[15px] leading-6 text-muted";
const pill =
  "rounded-full px-6 py-3.5 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40";
export const button = `${pill} liquid-glass text-black hover:bg-black/5`;
export const primaryButton = `${pill} bg-black text-white hover:bg-black/80`;
export const fieldBox = "rounded-2xl border border-line bg-transparent px-4 py-3 text-[15px]";
export const subtleBox = "rounded-2xl bg-surface-strong px-4 py-3.5 text-[15px] text-muted";
