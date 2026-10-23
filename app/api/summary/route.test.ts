import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/ai")>()),
  askText: vi.fn(),
}));

import { AiError, askText } from "../../../lib/ai";
import { resetRateLimits } from "../../../lib/rate-limit";
import { POST, SUMMARY_RATE_LIMIT } from "./route";

const askTextMock = vi.mocked(askText);

const body = {
  period: "2026-08",
  items: [
    { name: "전산업생산", comparison: "전월비", unit: "%", value: -1.3 },
    { name: "전산업생산", comparison: "전년동월비", unit: "%", value: 1.9 },
  ],
};

const goodText = "ʼ26.8월 산업활동동향 주요지표는 전산업생산 감소\n▪ 생산은 전산업생산(전월비 △1.3%, 전년비 1.9%) 감소";

function post(payload: unknown): Request {
  return new Request("http://localhost/api/summary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

beforeEach(() => {
  resetRateLimits();
  askTextMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/summary", () => {
  it("보낸 수치만 쓴 초안은 그대로 돌려준다", async () => {
    askTextMock.mockResolvedValue(goodText);
    const response = await POST(post(body));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ text: goodText, usedCount: 2 });
    expect(askTextMock).toHaveBeenCalledTimes(1);
  });

  it("AI에는 수치와 기준 달만 보내고 다른 내용은 보내지 않는다", async () => {
    askTextMock.mockResolvedValue(goodText);
    await POST(post({ ...body, extra: "작성본 내용입니다", pages: ["PDF 글자"] }));
    const prompt = askTextMock.mock.calls[0][0];
    expect(prompt.user).toContain("△1.3%");
    expect(prompt.user + prompt.system).not.toContain("작성본 내용입니다");
    expect(prompt.user + prompt.system).not.toContain("PDF 글자");
  });

  it("근거 없는 숫자가 섞이면 한 번 다시 쓰게 하고, 고쳐지면 받는다", async () => {
    askTextMock.mockResolvedValueOnce("전산업생산 △1.4% 감소").mockResolvedValueOnce(goodText);
    const response = await POST(post(body));
    expect(response.status).toBe(200);
    expect((await response.json()).text).toBe(goodText);
    expect(askTextMock).toHaveBeenCalledTimes(2);
    expect(askTextMock.mock.calls[1][0].user).toContain("1.4");
  });

  it("다시 써도 근거 없는 숫자가 있으면 초안을 받지 않는다", async () => {
    askTextMock.mockResolvedValue("전산업생산 △1.4% 감소");
    const response = await POST(post(body));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("1.4%");
    expect(askTextMock).toHaveBeenCalledTimes(2);
  });

  it("JSON이 아니거나 수치 형태가 틀리면 AI를 부르지 않고 400이다", async () => {
    expect((await POST(post("이건 JSON이 아님"))).status).toBe(400);
    expect((await POST(post({ period: "2026-08", items: [] }))).status).toBe(400);
    expect((await POST(post({ period: "8월", items: body.items }))).status).toBe(400);
    expect(askTextMock).not.toHaveBeenCalled();
  });

  it.each([
    ["설정", 500],
    ["인증", 502],
    ["한도", 429],
    ["시간 초과", 504],
    ["연결", 502],
    ["응답 형식", 502],
  ] as const)("AI 오류(%s)는 %i 상태와 한국어 설명으로 돌려준다", async (kind, status) => {
    askTextMock.mockRejectedValue(new AiError(kind, "설명입니다"));
    const response = await POST(post(body));
    expect(response.status).toBe(status);
    expect((await response.json()).error).toBe("설명입니다");
  });

  it("알 수 없는 오류는 500이고 원래 내용을 보여 주지 않는다", async () => {
    askTextMock.mockRejectedValue(new Error("secret-detail sk-123"));
    const response = await POST(post(body));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret-detail");
  });
});

describe("POST /api/summary — 호출 남용 방어", () => {
  it("JSON이 아닌 요청은 415, 다른 사이트의 요청은 403이다", async () => {
    const plain = new Request("http://localhost/api/summary", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(body),
    });
    expect((await POST(plain)).status).toBe(415);
    const foreign = new Request("http://localhost/api/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "https://evil.example", host: "localhost" },
      body: JSON.stringify(body),
    });
    expect((await POST(foreign)).status).toBe(403);
    expect(askTextMock).not.toHaveBeenCalled();
  });

  it("같은 사용자가 1분에 정해진 횟수를 넘기면 429이다", async () => {
    askTextMock.mockResolvedValue(goodText);
    const headers = { "Content-Type": "application/json", "x-forwarded-for": "4.4.4.4" };
    const send = () =>
      POST(new Request("http://localhost/api/summary", { method: "POST", headers, body: JSON.stringify(body) }));
    for (let i = 0; i < SUMMARY_RATE_LIMIT.limit; i++) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
    expect(askTextMock).toHaveBeenCalledTimes(SUMMARY_RATE_LIMIT.limit);
  });
});
