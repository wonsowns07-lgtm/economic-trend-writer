import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, POST } from "./route";

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

function upload(content: BlobPart | Uint8Array, name = "a.pdf", field = "file"): Request {
  const form = new FormData();
  // 바이트 배열은 새 배열로 복사해서 넘긴다. (타입 검사가 요구하는 형태로 맞추기 위함)
  const part = content instanceof Uint8Array ? new Uint8Array(content) : content;
  form.append(field, new File([part], name));
  return new Request("http://localhost/api/extract", { method: "POST", body: form });
}

describe("POST /api/extract", () => {
  it("PDF에서 쪽별 글자를 꺼내 돌려준다", async () => {
    const response = await POST(upload(makePdf("Hello Economy")));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pageCount).toBe(1);
    expect(body.pages).toHaveLength(1);
    expect(body.pages[0]).toContain("Hello Economy");
  });

  it("결과를 저장하지 않도록 no-store 머리말을 붙인다", async () => {
    const response = await POST(upload(makePdf("Hello")));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("파일이 없으면 400이다", async () => {
    const form = new FormData();
    form.append("other", "x");
    const request = new Request("http://localhost/api/extract", { method: "POST", body: form });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("파일 칸에 글자만 들어오면 400이다", async () => {
    const form = new FormData();
    form.append("file", "그냥 글자");
    const request = new Request("http://localhost/api/extract", { method: "POST", body: form });
    expect((await POST(request)).status).toBe(400);
  });

  it("빈 파일이면 400이다", async () => {
    expect((await POST(upload(new Uint8Array()))).status).toBe(400);
  });

  it("PDF가 아니면 400이고 한글 파일은 아직 안 된다고 알려 준다", async () => {
    const response = await POST(upload("hello world, not a pdf", "a.hwp"));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("한글 파일");
  });

  it("크기 한도를 넘으면 413이다", async () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(new TextEncoder().encode("%PDF-1.4"));
    expect((await POST(upload(big))).status).toBe(413);
  });

  it("머리글만 PDF이고 내용이 깨져 있으면 422이다", async () => {
    const broken = new TextEncoder().encode("%PDF-1.4\n이건 깨진 파일입니다");
    expect((await POST(upload(broken))).status).toBe(422);
  });

  it("오류 응답은 한국어 설명을 담는다", async () => {
    const response = await POST(upload(new Uint8Array()));
    expect(typeof (await response.json()).error).toBe("string");
  });
});
