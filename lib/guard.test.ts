import { beforeEach, describe, expect, it } from "vitest";
import { clientKey, guardRequest, type GuardOptions } from "./guard";
import { checkRateLimit, resetRateLimits } from "./rate-limit";

const options: GuardOptions = { name: "t", rule: { limit: 3, windowMs: 60_000 }, maxBodyBytes: 1000 };

function request(headers: Record<string, string> = {}, url = "http://app.example/api/x"): Request {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: "{}" });
}

beforeEach(() => resetRateLimits());

describe("checkRateLimit", () => {
  const rule = { limit: 2, windowMs: 1000 };

  it("한도 안에서는 통과하고 넘으면 막으며 기다릴 시간을 알려 준다", () => {
    expect(checkRateLimit("k", rule, 0).ok).toBe(true);
    expect(checkRateLimit("k", rule, 100).ok).toBe(true);
    const blocked = checkRateLimit("k", rule, 200);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(1);
  });

  it("시간 창이 지나면 다시 통과한다", () => {
    checkRateLimit("k", rule, 0);
    checkRateLimit("k", rule, 100);
    expect(checkRateLimit("k", rule, 1001).ok).toBe(true);
  });

  it("막힌 요청은 횟수에 더해지지 않아 기다리면 풀린다", () => {
    checkRateLimit("k", rule, 0);
    checkRateLimit("k", rule, 10);
    for (let t = 20; t < 900; t += 100) checkRateLimit("k", rule, t); // 계속 두드려도
    expect(checkRateLimit("k", rule, 1001).ok).toBe(true); // 첫 요청이 빠지는 순간 풀린다
  });

  it("사용자마다 따로 센다", () => {
    checkRateLimit("a", rule, 0);
    checkRateLimit("a", rule, 1);
    expect(checkRateLimit("a", rule, 2).ok).toBe(false);
    expect(checkRateLimit("b", rule, 2).ok).toBe(true);
  });
});

describe("clientKey", () => {
  it("프록시 머리글의 첫 주소를 쓰고, 없으면 unknown이다", () => {
    expect(clientKey(request({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientKey(request({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientKey(request())).toBe("unknown");
  });
});

describe("guardRequest", () => {
  it("올바른 요청은 통과한다", () => {
    expect(guardRequest(request({ origin: "http://app.example", host: "app.example" }), options)).toBeNull();
  });

  it("origin이 없어도(같은 사이트의 일반 요청 등) 통과한다", () => {
    expect(guardRequest(request(), options)).toBeNull();
  });

  it("JSON이 아니면 415이다", async () => {
    const response = guardRequest(request({ "Content-Type": "text/plain" }), options);
    expect(response?.status).toBe(415);
  });

  it("다른 사이트에서 온 요청은 403이다", () => {
    const response = guardRequest(request({ origin: "https://evil.example", host: "app.example" }), options);
    expect(response?.status).toBe(403);
  });

  it("읽을 수 없는 origin도 403이다", () => {
    expect(guardRequest(request({ origin: "not a url", host: "app.example" }), options)?.status).toBe(403);
  });

  it("본문이 상한보다 크다고 알리면 413이다", () => {
    expect(guardRequest(request({ "content-length": "1001" }), options)?.status).toBe(413);
    expect(guardRequest(request({ "content-length": "1000" }), options)).toBeNull();
  });

  it("호출이 너무 잦으면 429와 기다릴 시간을 돌려준다", async () => {
    const headers = { "x-forwarded-for": "9.9.9.9" };
    for (let i = 0; i < 3; i++) expect(guardRequest(request(headers), options)).toBeNull();
    const blocked = guardRequest(request(headers), options);
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("Retry-After")).toBeTruthy();
    expect((await blocked!.json()).error).toContain("너무 잦습니다");
    // 다른 사용자는 영향이 없다
    expect(guardRequest(request({ "x-forwarded-for": "8.8.8.8" }), options)).toBeNull();
  });

  it("라우트 이름이 다르면 따로 센다", () => {
    const headers = { "x-forwarded-for": "7.7.7.7" };
    for (let i = 0; i < 3; i++) guardRequest(request(headers), options);
    expect(guardRequest(request(headers), { ...options, name: "other" })).toBeNull();
  });
});
