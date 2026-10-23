import { describe, expect, it } from "vitest";
import { extractPdfPages, looksLikePdf } from "./pdf";

/** 시험용으로 영어 한 줄만 들어 있는 아주 작은 PDF를 만든다. */
function makePdf(text: string): Uint8Array {
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefStart = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe("looksLikePdf", () => {
  it("%PDF-로 시작하면 PDF로 본다", () => {
    expect(looksLikePdf(makePdf("Hello"))).toBe(true);
  });

  it("다른 파일, 빈 파일, 너무 짧은 파일은 PDF가 아니다", () => {
    expect(looksLikePdf(new TextEncoder().encode("hello world"))).toBe(false);
    expect(looksLikePdf(new Uint8Array())).toBe(false);
    expect(looksLikePdf(new TextEncoder().encode("%PDF"))).toBe(false);
  });
});

describe("extractPdfPages", () => {
  it("쪽별 글자를 꺼낸다", async () => {
    const result = await extractPdfPages(makePdf("Hello Economy"));
    expect(result.pageCount).toBe(1);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]).toContain("Hello Economy");
  });

  it("머리글만 PDF이고 내용이 깨져 있으면 오류를 던진다", async () => {
    const broken = new TextEncoder().encode("%PDF-1.4\n이건 깨진 파일입니다");
    await expect(extractPdfPages(broken)).rejects.toThrow();
  });
});
