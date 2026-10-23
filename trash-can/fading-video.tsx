"use client";

// 배경 영상. CSS 전환 대신 requestAnimationFrame으로 투명도를 직접 바꿔 끝에서 서서히 사라졌다가 다시 시작한다.
// 움직임을 줄이도록 설정한 사람에게는 영상을 틀지 않는다.

import { useEffect, useRef } from "react";

const FADE_MS = 500;
const FADE_OUT_LEAD = 0.55;

export default function FadingVideo({ src, className, style }: { src: string; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let fadingOut = false;
    let restart: ReturnType<typeof setTimeout> | undefined;

    // 지금 투명도에서 시작해 target까지 duration 동안 바꾼다. 이전 전환이 있으면 멈추고 이어받는다.
    const fadeTo = (target: number, duration: number) => {
      cancelAnimationFrame(raf);
      const from = parseFloat(video.style.opacity || "0");
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        video.style.opacity = String(from + (target - from) * t);
        if (t < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };

    const onLoaded = () => {
      video.style.opacity = "0";
      void video.play().catch(() => undefined);
      fadeTo(1, FADE_MS);
    };
    const onTime = () => {
      const remaining = video.duration - video.currentTime;
      if (!fadingOut && remaining <= FADE_OUT_LEAD && remaining > 0) {
        fadingOut = true;
        fadeTo(0, FADE_MS);
      }
    };
    const onEnded = () => {
      video.style.opacity = "0";
      restart = setTimeout(() => {
        video.currentTime = 0;
        void video.play().catch(() => undefined);
        fadingOut = false;
        fadeTo(1, FADE_MS);
      }, 100);
    };

    video.addEventListener("loadeddata", onLoaded);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("ended", onEnded);
    if (video.readyState >= 2) onLoaded();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(restart);
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("ended", onEnded);
    };
  }, []);

  return <video ref={ref} src={src} autoPlay muted playsInline preload="auto" aria-hidden="true" className={className} style={{ opacity: 0, ...style }} />;
}
