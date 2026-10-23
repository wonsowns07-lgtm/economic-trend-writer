import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AiError,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL,
  askJson,
  askText,
  createAiClient,
  resolveModel,
  toAiError,
  type AiClient,
} from "./ai";

const FAKE_KEY = "sk-test-secret-key-1234567890";

/** 정해진 답을 돌려주거나 정해진 오류를 던지는 가짜 AI 클라이언트. 받은 요청도 기록한다. */
function fakeClient(reply: string | null | Error) {
  const calls: Parameters<AiClient["chat"]["completions"]["create"]>[0][] = [];
  const client: AiClient = {
    chat: {
      completions: {
        async create(params) {
          calls.push(params);
          if (reply instanceof Error) throw reply;
          return { choices: [{ message: { content: reply } }] };
        },
      },
    },
  };
  return { client, calls };
}

function apiError(status: number, name = "APIError") {
  const error = new Error(`HTTP ${status} key=${FAKE_KEY}`) as Error & { status: number };
  error.name = name;
  error.status = status;
  return error;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveModel / createAiClient", () => {
  it("OPENAI_MODEL이 없으면 기본 모델을 쓴다", () => {
    expect(resolveModel({})).toBe(DEFAULT_MODEL);
    expect(resolveModel({ OPENAI_MODEL: "  " })).toBe(DEFAULT_MODEL);
  });

  it("OPENAI_MODEL이 있으면 그 모델을 쓴다", () => {
    expect(resolveModel({ OPENAI_MODEL: "gpt-5.5" })).toBe("gpt-5.5");
  });

  it("키가 없으면 설정 오류를 던지고 .env를 안내한다", () => {
    expect(() => createAiClient({})).toThrow(AiError);
    try {
      createAiClient({ OPENAI_API_KEY: "   " });
    } catch (error) {
      expect(error).toBeInstanceOf(AiError);
      expect((error as AiError).kind).toBe("설정");
      expect((error as AiError).message).toContain("OPENAI_API_KEY");
    }
  });

  it("키가 있으면 클라이언트를 만든다", () => {
    const client = createAiClient({ OPENAI_API_KEY: FAKE_KEY });
    expect(typeof client.chat.completions.create).toBe("function");
  });

  it("브라우저(화면 코드)에서는 만들 수 없다", () => {
    vi.stubGlobal("window", {});
    expect(() => createAiClient({ OPENAI_API_KEY: FAKE_KEY })).toThrow(/서버 코드/);
  });
});

describe("askText", () => {
  it("답의 길이 상한을 항상 붙여서 보낸다", async () => {
    const { client, calls } = fakeClient("답");
    await askText({ system: "S", user: "U" }, { client });
    expect(calls[0].max_completion_tokens).toBe(DEFAULT_MAX_TOKENS);
    await askText({ system: "S", user: "U" }, { client, maxTokens: 500 });
    expect(calls[1].max_completion_tokens).toBe(500);
  });

  it("요청을 모델·시스템·사용자 글로 보내고 답을 다듬어 돌려준다", async () => {
    const { client, calls } = fakeClient("  연결됨  ");
    const answer = await askText({ system: "S", user: "U" }, { client, model: "m1" });
    expect(answer).toBe("연결됨");
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("m1");
    expect(calls[0].messages).toEqual([
      { role: "system", content: "S" },
      { role: "user", content: "U" },
    ]);
    expect(calls[0].response_format).toBeUndefined();
  });

  it("빈 답이면 응답 형식 오류다", async () => {
    const { client } = fakeClient(null);
    await expect(askText({ system: "S", user: "U" }, { client })).rejects.toMatchObject({
      kind: "응답 형식",
    });
  });
});

describe("askJson", () => {
  const schema = z.object({ name: z.string(), value: z.number() });

  it("형태가 맞으면 검사한 값을 돌려주고 JSON 답을 요청한다", async () => {
    const { client, calls } = fakeClient('{"name":"전산업생산","value":-1.3}');
    const result = await askJson(schema, { system: "S", user: "U" }, { client });
    expect(result).toEqual({ name: "전산업생산", value: -1.3 });
    expect(calls[0].response_format).toEqual({ type: "json_object" });
    expect(calls[0].messages[0].content).toContain("JSON");
  });

  it("JSON이 아니면 응답 형식 오류다", async () => {
    const { client } = fakeClient("그냥 글입니다");
    await expect(askJson(schema, { system: "S", user: "U" }, { client })).rejects.toMatchObject({
      kind: "응답 형식",
      message: expect.stringContaining("JSON"),
    });
  });

  it("약속한 형태와 다르면 어디가 다른지 알려 주는 응답 형식 오류다", async () => {
    const { client } = fakeClient('{"name":"전산업생산","value":"많음"}');
    await expect(askJson(schema, { system: "S", user: "U" }, { client })).rejects.toMatchObject({
      kind: "응답 형식",
      message: expect.stringContaining("value"),
    });
  });
});

describe("오류 바꾸기 (toAiError)", () => {
  it.each([
    [apiError(401), "인증"],
    [apiError(403), "인증"],
    [apiError(429), "한도"],
    [apiError(500), "알 수 없음"],
    [apiError(0, "APIConnectionTimeoutError"), "시간 초과"],
    [apiError(0, "APIConnectionError"), "연결"],
    [new Error("뭔가"), "알 수 없음"],
  ] as const)("%s → %s", (error, kind) => {
    expect(toAiError(error).kind).toBe(kind);
  });

  it("바뀐 오류 설명에는 키나 원래 오류 내용이 들어가지 않는다", async () => {
    for (const error of [apiError(401), apiError(429), apiError(500), apiError(0, "APIConnectionError")]) {
      const { client } = fakeClient(error);
      try {
        await askText({ system: "S", user: "U" }, { client });
        expect.unreachable();
      } catch (caught) {
        expect(caught).toBeInstanceOf(AiError);
        expect((caught as AiError).message).not.toContain(FAKE_KEY);
        expect((caught as AiError).message).not.toContain("sk-");
      }
    }
  });

  it("이미 AiError이면 그대로 둔다", () => {
    const original = new AiError("설정", "x");
    expect(toAiError(original)).toBe(original);
  });
});
