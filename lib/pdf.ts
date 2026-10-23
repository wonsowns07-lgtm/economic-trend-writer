// Design Ref: §2.2 1단계 — PDF에서 글자를 꺼낸다. 담당자의 브라우저 안에서 쓰고, 파일은 서버로 보내지 않는다.
// Plan SC: PLAN 5번 작업. 쪽 번호를 알 수 있게 쪽별로 나누어 돌려준다. (오류 항목에 원자료 위치를 보여 주기 위해)

import { extractText, getDocumentProxy } from "unpdf";

export interface PdfPages {
  /** 전체 쪽 수 */
  pageCount: number;
  /** 쪽별 글자. pages[0]이 1쪽이다. */
  pages: string[];
}

/** PDF 파일의 첫 다섯 글자("%PDF-")를 보고 PDF인지 확인한다. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const signature = "%PDF-";
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * PDF 바이트에서 쪽별 글자를 꺼낸다.
 * 파일이 손상됐거나 암호가 걸려 있으면 오류를 던진다.
 */
export async function extractPdfPages(bytes: Uint8Array): Promise<PdfPages> {
  const pdf = await getDocumentProxy(bytes);
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    return { pageCount: totalPages, pages: text };
  } finally {
    // 읽기가 끝나면 PDF가 차지한 메모리를 돌려준다.
    await pdf.loadingTask.destroy();
  }
}
