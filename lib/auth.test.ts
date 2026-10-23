import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearedCookie,
  getPassword,
  isAuthorized,
  passwordMatches,
  requireAuth,
  SESSION_COOKIE,
  sessionCookie,
  sessionToken,
} from "./auth";

const PASSWORD = "시험용-비밀번호";
const withCookie = (cookie: string) => new Request("http://localhost/api/x", { headers: { cookie } });

afterEach(() => vi.unstubAllEnvs());

describe("getPassword", () => {
  it("비어 있거나 공백뿐이면 설정되지 않은 것으로 본다", () => {
    expect(getPassword({})).toBeNull();
    expect(getPassword({ APP_PASSWORD: "" })).toBeNull();
    expect(getPassword({ APP_PASSWORD: "   " })).toBeNull();
    expect(getPassword({ APP_PASSWORD: " abc " })).toBe("abc");
  });
});

describe("passwordMatches", () => {
  it("같은 글자만 맞는다", () => {
    expect(passwordMatches(PASSWORD, PASSWORD)).toBe(true);
    expect(passwordMatches(PASSWORD + "x", PASSWORD)).toBe(false);
    expect(passwordMatches("", PASSWORD)).toBe(false);
  });
});

describe("isAuthorized", () => {
  it("올바른 확인표가 있으면 통과한다", () => {
    expect(isAuthorized(withCookie(`${SESSION_COOKIE}=${sessionToken(PASSWORD)}`), PASSWORD)).toBe(true);
    expect(isAuthorized(withCookie(`a=1; ${SESSION_COOKIE}=${sessionToken(PASSWORD)}; b=2`), PASSWORD)).toBe(true);
  });
  it("확인표가 없거나 틀리거나 다른 비밀번호로 만든 것이면 막는다", () => {
    expect(isAuthorized(new Request("http://localhost/"), PASSWORD)).toBe(false);
    expect(isAuthorized(withCookie(`${SESSION_COOKIE}=abc`), PASSWORD)).toBe(false);
    expect(isAuthorized(withCookie(`${SESSION_COOKIE}=${sessionToken("다른 비밀번호")}`), PASSWORD)).toBe(false);
  });
  it("비밀번호가 설정되지 않았으면 무엇이든 막는다", () => {
    expect(isAuthorized(withCookie(`${SESSION_COOKIE}=${sessionToken("")}`), null)).toBe(false);
  });
});

describe("requireAuth", () => {
  it("비밀번호 미설정이면 503", async () => {
    vi.stubEnv("APP_PASSWORD", "");
    const response = requireAuth(new Request("http://localhost/"));
    expect(response?.status).toBe(503);
  });
  it("확인표가 없으면 401, 있으면 통과", () => {
    vi.stubEnv("APP_PASSWORD", PASSWORD);
    expect(requireAuth(new Request("http://localhost/"))?.status).toBe(401);
    expect(requireAuth(withCookie(`${SESSION_COOKIE}=${sessionToken(PASSWORD)}`))).toBeNull();
  });
});

describe("쿠키 머리글", () => {
  it("HttpOnly·SameSite=Strict이고 운영에서는 Secure가 붙는다", () => {
    const cookie = sessionCookie(PASSWORD, true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain(PASSWORD);
    expect(sessionCookie(PASSWORD, false)).not.toContain("Secure");
    expect(clearedCookie(false)).toContain("Max-Age=0");
  });
});
