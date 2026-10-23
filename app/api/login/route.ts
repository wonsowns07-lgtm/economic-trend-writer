// 비밀번호를 확인하고 맞으면 로그인 확인표(쿠키)를 준다. 틀린 시도는 1분에 5번까지만 받는다.

import { z } from "zod";
import { getPassword, passwordMatches, sessionCookie } from "../../../lib/auth";
import { guardRequest } from "../../../lib/guard";

export const LOGIN_RATE_LIMIT = { limit: 5 };
const MAX_BODY_BYTES = 2_000;
const NO_STORE = { "Cache-Control": "no-store" };

const Body = z.object({ password: z.string().min(1).max(200) });

export async function POST(request: Request) {
  const blocked = guardRequest(request, { name: "login", rule: LOGIN_RATE_LIMIT, maxBodyBytes: MAX_BODY_BYTES });
  if (blocked) return blocked;

  const password = getPassword();
  if (password === null) {
    return Response.json(
      { error: "비밀번호가 설정되지 않았습니다. .env 파일의 APP_PASSWORD를 채워 주세요." },
      { status: 503, headers: NO_STORE },
    );
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !passwordMatches(parsed.data.password, password)) {
    return Response.json({ error: "비밀번호가 맞지 않습니다." }, { status: 401, headers: NO_STORE });
  }

  const secure = process.env.NODE_ENV === "production";
  return Response.json({ ok: true }, { headers: { ...NO_STORE, "Set-Cookie": sessionCookie(password, secure) } });
}
