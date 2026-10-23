// Design Ref: §4 폴더 구조 — lib/ai.ts는 AI 호출을 한곳에 모은다. 서버 코드에서만 쓰고, 키는 .env의 OPENAI_API_KEY에서만 읽는다.
// Plan SC: PLAN 6번 작업. 키는 코드·화면·오류 메시지에 절대 나오지 않는다. AI는 수치 추출과 종합평가 문장에만 쓴다.

import OpenAI from "openai";
import type { ZodType } from "zod";

/** 기본으로 쓰는 모델. 필요하면 .env에 OPENAI_MODEL을 적어 바꿀 수 있다. */
export const DEFAULT_MODEL = "gpt-5.4-mini";

/** AI 서비스를 부를 때 기다리는 최대 시간(밀리초). */
const REQUEST_TIMEOUT_MS = 60_000;

/** 실패했을 때 자동으로 다시 시도하는 횟수. 기본값(2회)이면 한 번 부를 때 비용·시간이 세 배가 될 수 있어 1회로 줄였다. */
const MAX_RETRIES = 1;

/** 답의 길이 기본 상한(토큰). 추론하는 모델은 생각하는 데도 이 양을 쓰므로 넉넉히 잡는다. */
export const DEFAULT_MAX_TOKENS = 4_000;

export type AiErrorKind =
  | "설정" // 키가 없거나 잘못된 곳에서 불렀다
  | "인증" // 키가 거절됐다
  | "한도" // 호출 횟수·사용 한도를 넘었다
  | "시간 초과"
  | "연결" // 네트워크 문제
  | "응답 형식" // 받은 답을 읽을 수 없다
  | "알 수 없음";

/** 담당자에게 보여 줄 수 있는 한국어 설명을 담은 오류. 키 값은 절대 담지 않는다. */
export class AiError extends Error {
  readonly kind: AiErrorKind;

  constructor(kind: AiErrorKind, message: string) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
  }
}

/** 이 모듈이 쓰는 AI 클라이언트의 최소 모양. 시험에서 가짜로 바꿔 끼우기 위해 따로 정의한다. */
export interface AiClient {
  chat: {
    completions: {
      create(params: {
        model: string;
        messages: { role: "system" | "user"; content: string }[];
        response_format?: { type: "json_object" };
        max_completion_tokens?: number;
      }): Promise<{ choices: { message: { content: string | null } }[] }>;
    };
  };
}

export interface AiOptions {
  /** 시험에서 가짜 클라이언트를 넘길 때 쓴다. 생략하면 .env의 키로 만든다. */
  client?: AiClient;
  /** 모델 이름. 생략하면 OPENAI_MODEL 또는 기본 모델을 쓴다. */
  model?: string;
  /** AI가 쓰는 답의 길이 상한(토큰). 생략하면 기본 상한을 쓴다. 비용이 끝없이 늘지 않게 항상 상한을 둔다. */
  maxTokens?: number;
}

export interface AiPrompt {
  system: string;
  user: string;
}

type Env = Record<string, string | undefined>;

/** 쓸 모델 이름을 정한다. */
export function resolveModel(env: Env = process.env): string {
  return env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * .env의 OPENAI_API_KEY로 AI 클라이언트를 만든다.
 * 브라우저(화면 코드)에서 부르면 키가 노출될 수 있으므로 막는다.
 */
export function createAiClient(env: Env = process.env): AiClient {
  if (typeof window !== "undefined") {
    throw new AiError("설정", "AI 호출은 서버 코드에서만 할 수 있습니다.");
  }
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new AiError("설정", "AI 서비스 키가 없습니다. .env 파일의 OPENAI_API_KEY를 확인해 주세요.");
  }
  return new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: MAX_RETRIES }) as unknown as AiClient;
}

let cachedClient: AiClient | null = null;

function getClient(options: AiOptions): AiClient {
  if (options.client) return options.client;
  cachedClient ??= createAiClient();
  return cachedClient;
}

/** AI 서비스가 돌려준 오류를 담당자가 읽을 수 있는 설명으로 바꾼다. 원래 오류 내용(키가 섞일 수 있음)은 담지 않는다. */
export function toAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  const status = (error as { status?: unknown } | null)?.status;
  const name = error instanceof Error ? error.name : "";

  if (status === 401 || status === 403) {
    return new AiError("인증", "AI 서비스가 키를 받아 주지 않았습니다. .env의 OPENAI_API_KEY를 확인해 주세요.");
  }
  if (status === 429) {
    return new AiError("한도", "AI 서비스의 사용 한도를 넘었습니다. 잠시 뒤에 다시 시도해 주세요.");
  }
  if (name === "APIConnectionTimeoutError") {
    return new AiError("시간 초과", "AI 서비스의 응답이 너무 늦어 중단했습니다. 다시 시도해 주세요.");
  }
  if (name === "APIConnectionError") {
    return new AiError("연결", "AI 서비스에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.");
  }
  return new AiError("알 수 없음", "AI 서비스를 부르는 중 문제가 생겼습니다. 잠시 뒤에 다시 시도해 주세요.");
}

async function complete(
  prompt: AiPrompt,
  options: AiOptions,
  responseFormat?: { type: "json_object" },
): Promise<string> {
  const client = getClient(options);
  try {
    const response = await client.chat.completions.create({
      model: options.model ?? resolveModel(),
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      ...(responseFormat ? { response_format: responseFormat } : {}),
      max_completion_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    });
    const content = response.choices[0]?.message.content?.trim();
    if (!content) {
      throw new AiError("응답 형식", "AI 서비스가 빈 답을 돌려줬습니다. 다시 시도해 주세요.");
    }
    return content;
  } catch (error) {
    throw toAiError(error);
  }
}

/** AI에게 물어보고 글로 된 답을 받는다. (종합평가 문장 작성 등) */
export async function askText(prompt: AiPrompt, options: AiOptions = {}): Promise<string> {
  return complete(prompt, options);
}

/**
 * AI에게 물어보고 JSON 답을 받아, 약속한 형태(schema)가 맞는지 검사한 뒤 돌려준다. (수치 추출 등)
 * 형태가 맞지 않으면 틀린 수치가 화면에 들어오지 않도록 오류를 던진다.
 */
export async function askJson<T>(
  schema: ZodType<T>,
  prompt: AiPrompt,
  options: AiOptions = {},
): Promise<T> {
  // JSON 형식 답을 받으려면 요청 글에 "JSON"이라는 말이 있어야 한다.
  const content = await complete(
    { ...prompt, system: `${prompt.system}\n\n반드시 JSON 형식으로만 답하세요.` },
    options,
    { type: "json_object" },
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new AiError("응답 형식", "AI 서비스의 답이 JSON 형식이 아니라서 읽을 수 없습니다.");
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const where = result.error.issues
      .slice(0, 3)
      .map((issue) => issue.path.join(".") || "(최상위)")
      .join(", ");
    throw new AiError("응답 형식", `AI 서비스의 답이 약속한 형태와 다릅니다. (문제 위치: ${where})`);
  }
  return result.data;
}
