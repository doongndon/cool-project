/* AI 손주 — Gemini 프록시 (Cloudflare Workers)
   목적: 어르신이 키를 만지지 않게 키를 서버에 숨긴다.
   - 키는 이 코드에 없다. Cloudflare 대시보드의 환경변수(Secret) GEMINI_KEY 에만 있다.
   - 공개 코드에 키가 없으니 절대 유출·정지되지 않는다.
   - 앱은 이 주소로 요청하고, 여기서 진짜 Gemini를 대신 불러 결과만 돌려준다.

   배포 방법 (무료, 약 10분):
   1) https://dash.cloudflare.com → Workers & Pages → Create → Worker
   2) 이 파일 내용 붙여넣고 Deploy
   3) Settings → Variables → "GEMINI_KEY" 라는 이름으로 본인 Gemini 키 추가 (Encrypt)
   4) 배포된 주소(예: https://ai-sonju.<계정>.workers.dev)를 js/app.js 의 PROXY_URL 에 넣기
*/

const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// 이 앱이 배포된 주소에서 온 요청만 허용 (남이 우리 프록시를 못 쓰게)
const ALLOW_ORIGINS = [
  "https://doongndon.github.io",
  "http://localhost:8000",
  "http://localhost:8811",
];

function cors(origin) {
  const ok = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": ok,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
    if (request.method !== "POST") return new Response("only POST", { status: 405, headers: cors(origin) });

    const key = env.GEMINI_KEY;
    if (!key) return json({ error: "서버에 키가 설정되지 않았어요." }, 500, origin);

    let body;
    try { body = await request.json(); } catch (_) { return json({ error: "잘못된 요청" }, 400, origin); }

    // 사용량 초과(429)나 미지원(404)이면 다음 모델로 자동 전환
    let last = null;
    for (const model of MODELS) {
      const res = await fetch(`${BASE}/${model}:generateContent?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 404 || res.status === 429) { last = res; continue; }
      const text = await res.text();
      return new Response(text, { status: res.status, headers: { "Content-Type": "application/json", ...cors(origin) } });
    }
    const text = last ? await last.text() : JSON.stringify({ error: "사용 가능한 모델이 없어요." });
    return new Response(text, { status: last ? last.status : 500, headers: { "Content-Type": "application/json", ...cors(origin) } });
  },
};

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}
