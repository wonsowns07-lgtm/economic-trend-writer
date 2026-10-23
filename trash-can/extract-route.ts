// Design Ref: §4 폴더 구조 — app/api/extract/route.ts. 파일 받기 → 글자 꺼내기. (AI 수치 추출은 PLAN 7번에서 이어 붙인다.)
// Plan SC: PLAN 5번 작업. 업로드한 파일은 저장하지 않고 요청이 끝나면 버린다. 내용은 기록(로그)에도 남기지 않는다.

import { extractPdfPages, looksLikePdf } from "../../../lib/pdf";

/**
 * 한 번에 받을 수 있는 파일 크기. 실제 산업활동동향 PDF가 약 7MB라서 10MB로 둔다.
 * 주의: Vercel에 배포하면 서버 코드가 받을 수 있는 요청 크기에 별도 한도(약 4.5MB로 알려짐)가 있다.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const NO_STORE = { "Cache-Control": "no-store" };

function fail(status: number, error: string) {
  return Response.json({ error }, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "올린 내용을 읽을 수 없습니다. 파일을 다시 선택해 주세요.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return fail(400, "PDF 파일을 선택해 주세요.");
  }
  if (file.size === 0) {
    return fail(400, "빈 파일입니다. 다른 파일을 선택해 주세요.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const limitMb = MAX_UPLOAD_BYTES / (1024 * 1024);
    return fail(413, `파일이 너무 큽니다. ${limitMb}MB 이하의 파일을 올려 주세요.`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) {
    return fail(400, "PDF 파일이 아닙니다. (한글 파일은 아직 지원하지 않습니다.)");
  }

  let result;
  try {
    result = await extractPdfPages(bytes);
  } catch (error) {
    // 파일 내용이 기록에 남지 않도록 오류의 종류(이름)만 남긴다.
    console.error("PDF 글자 꺼내기 실패:", error instanceof Error ? error.name : "알 수 없는 오류");
    return fail(422, "PDF에서 글자를 꺼내지 못했습니다. 파일이 손상되었거나 암호가 걸려 있을 수 있습니다.");
  }

  if (result.pages.every((page) => page.trim() === "")) {
    return fail(422, "PDF에 글자가 없습니다. 그림으로만 된 스캔본일 수 있습니다.");
  }

  return Response.json(result, { headers: NO_STORE });
}
