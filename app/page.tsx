// Design Ref: §1 화면 구성 — 한 페이지에 다섯 칸(① 자료 올리기 ~ ⑤ 종합평가 초안)이 세로로 이어진다.
// Plan SC: PLAN 8~13번 작업. 다섯 칸 모두 ExtractPanel에서 동작한다.

import Image from "next/image";
import ExtractPanel from "./extract-panel";

export default function Home() {
  return (
    <>
      {/* 위쪽에 붙어 있는 반투명 상단 바. 로고는 투명 배경 PNG이고 글씨가 진한 회색이라 어두운 화면에서도 보이도록 흰 칸에 둔다. */}
      <div className="sticky top-0 z-10 border-b border-line bg-[var(--header-bg)] backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center px-5 sm:px-6">
          <div className="rounded-xl bg-white px-3 py-1.5">
            <Image
              src="/logo.png"
              alt="재정경제부"
              width={2000}
              height={633}
              sizes="160px"
              loading="eager"
              fetchPriority="high"
              className="h-8 w-auto"
            />
          </div>
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-5 pb-16 pt-10 sm:px-6 sm:pt-14">
        <header className="pb-4">
          <h1 className="text-[2rem] font-bold leading-tight tracking-tight sm:text-5xl">
            최근경제동향
            <br />
            작성 도우미
          </h1>
          <p className="mt-5 text-lg leading-8 text-muted">
            산업활동동향 보도자료에서 수치를 뽑고, 오류를 검증하고, 종합평가 초안을 만들어 드립니다.
          </p>
          <p className="mt-2 text-[15px] leading-6 text-muted/70">
            공개된 보도자료만 올려 주세요. 작성본은 이 화면 밖으로 나가지 않습니다.
          </p>
        </header>

        <ExtractPanel />
      </main>
    </>
  );
}
