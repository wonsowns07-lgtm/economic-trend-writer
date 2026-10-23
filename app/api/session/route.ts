// 지금 로그인된 상태인지 알려 준다. 화면이 입력란을 보여 줄지 정하는 데만 쓰고, 실제 잠금은 각 API가 따로 확인한다.

import { clearedCookie, getPassword, isAuthorized } from "../../../lib/auth";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const password = getPassword();
  return Response.json(
    { configured: password !== null, authenticated: isAuthorized(request, password) },
    { headers: NO_STORE },
  );
}

/** 로그아웃: 확인표를 지운다. */
export async function DELETE() {
  const secure = process.env.NODE_ENV === "production";
  return Response.json({ ok: true }, { headers: { ...NO_STORE, "Set-Cookie": clearedCookie(secure) } });
}
