// 혼자 쓰는 비밀번호 잠금. 비밀번호는 서버의 환경변수(.env의 APP_PASSWORD)에만 두고 코드·화면·로그에 남기지 않는다.
// 로그인에 성공하면 비밀번호에서 만든 확인표(쿠키)를 주고, 서버 코드(API)는 그 확인표가 없으면 일을 시작하지 않는다.
// (화면만 가리면 주소로 바로 호출해 AI 비용을 쓸 수 있으므로 서버에서 막는다.)

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "app_session";
/** 로그인 유지 기간(초). 30일 */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

const NO_STORE = { "Cache-Control": "no-store" };

/** 설정된 비밀번호. 없거나 비어 있으면 null이다. */
export function getPassword(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.APP_PASSWORD?.trim();
  return value ? value : null;
}

/** 비밀번호에서 만든 확인표. 비밀번호를 바꾸면 예전 확인표는 모두 못 쓰게 된다. */
export function sessionToken(password: string): string {
  return createHmac("sha256", password).update("recent-economy-helper:session:v1").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

/** 입력한 비밀번호가 맞는지. 글자 수나 틀린 위치가 시간으로 드러나지 않게 비교한다. */
export function passwordMatches(input: string, password: string): boolean {
  return safeEqual(input, password);
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

/** 요청에 올바른 확인표가 있는지. */
export function isAuthorized(request: Request, password: string | null = getPassword()): boolean {
  if (password === null) return false;
  const token = readCookie(request, SESSION_COOKIE);
  return token !== null && safeEqual(token, sessionToken(password));
}

/**
 * 서버 코드(API)가 일을 시작하기 전에 부른다. 통과하면 null, 막으면 그대로 돌려줄 응답이다.
 * 비밀번호가 설정되지 않았으면 모두 막는다. (설정을 깜빡해서 문이 열려 버리는 것을 막기 위함)
 */
export function requireAuth(request: Request): Response | null {
  const password = getPassword();
  if (password === null) {
    return Response.json(
      { error: "비밀번호가 설정되지 않았습니다. .env 파일의 APP_PASSWORD를 채워 주세요." },
      { status: 503, headers: NO_STORE },
    );
  }
  if (!isAuthorized(request, password)) {
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401, headers: NO_STORE });
  }
  return null;
}

/** 확인표 쿠키 머리글 값. 자바스크립트로 읽을 수 없고(HttpOnly), 다른 사이트에서 따라 보내지 않는다(SameSite=Strict). */
export function sessionCookie(password: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${sessionToken(password)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${SESSION_MAX_AGE}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearedCookie(secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
