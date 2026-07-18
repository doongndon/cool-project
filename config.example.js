// ── AI 손주 설정 ──
// 어르신이 키를 만지지 않게 하려면 아래 둘 중 하나:
//
// [권장] 프록시 서버 방식 — 키가 서버에 숨겨져 절대 유출·정지 안 됨
//   proxy/worker.js 를 Cloudflare에 배포한 뒤, 그 주소를 여기에 넣으세요.
//   그러면 어르신은 링크만 열면 바로 작동합니다.
// window.AI_SONJU_PROXY_URL = "https://ai-sonju.본인계정.workers.dev";
//
// [로컬 개발용] 키 직접 넣기 — 공개 저장소에는 올리지 마세요(구글이 정지시킴).
// window.AI_SONJU_DEFAULT_KEY = "AIza...";
