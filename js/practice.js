/* ============================================================
   연습 모드 — AI가 튜토리얼을 직접 설계하는 가상 폰
   어르신이 "무음으로 바꿔줘"라고 부탁하면,
   AI(Gemini)가 가상 폰의 UI 지도를 보고 스스로 단계를 계획한다.
   계획은 검증을 거쳐 가상 폰 위에서 스포트라이트 안내로 실행된다.
   ============================================================ */

"use strict";

(function () {
  const $ = (id) => document.getElementById(id);

  // ---------- 가상 폰 UI 지도 ----------
  // 각 요소: 어느 화면(screen)에 있고, 누르면 어디로 가는지(goto) / 무슨 효과(effect)인지
  const ELEMENTS = {
    "fp-app-settings": { screen: "fp-home", goto: "fp-set-main", desc: "'설정' 앱 아이콘" },
    "fp-app-kakao": { screen: "fp-home", goto: "fp-kakao-list", desc: "'카카오톡' 앱 아이콘" },

    "fp-row-connect": { screen: "fp-set-main", goto: "fp-set-connect", desc: "'연결' 메뉴 (Wi-Fi, 블루투스)" },
    "fp-row-sound": { screen: "fp-set-main", goto: "fp-set-sound", desc: "'소리·진동' 메뉴 (무음 모드, 벨소리)" },
    "fp-row-display": { screen: "fp-set-main", goto: "fp-set-display", desc: "'디스플레이' 메뉴 (밝기, 글자 크기)" },

    "fp-row-fontsize": { screen: "fp-set-display", goto: "fp-set-fontsize", desc: "'글자 크기' 메뉴" },
    "fp-row-timeout": { screen: "fp-set-display", goto: "fp-set-timeout", desc: "'화면 자동 꺼짐' 메뉴" },

    "fp-size-small": { screen: "fp-set-fontsize", effect: "fontSel", desc: "글자 크기 '작게' 버튼" },
    "fp-size-mid": { screen: "fp-set-fontsize", effect: "fontSel", desc: "글자 크기 '보통' 버튼" },
    "fp-size-large": { screen: "fp-set-fontsize", effect: "fontSel", desc: "글자 크기 '크게' 버튼" },

    "fp-mute-switch": { screen: "fp-set-sound", effect: "muteToggle", desc: "무음 모드 스위치" },
    "fp-vol-small": { screen: "fp-set-sound", effect: "volSel", desc: "벨소리 크기 '작게' 버튼" },
    "fp-vol-mid": { screen: "fp-set-sound", effect: "volSel", desc: "벨소리 크기 '보통' 버튼" },
    "fp-vol-big": { screen: "fp-set-sound", effect: "volSel", desc: "벨소리 크기 '크게' 버튼" },

    "fp-timeout-30": { screen: "fp-set-timeout", effect: "timeoutSel", desc: "화면 꺼짐 '30초' 버튼" },
    "fp-timeout-60": { screen: "fp-set-timeout", effect: "timeoutSel", desc: "화면 꺼짐 '1분' 버튼" },
    "fp-timeout-300": { screen: "fp-set-timeout", effect: "timeoutSel", desc: "화면 꺼짐 '5분' 버튼" },

    "fp-row-wifi": { screen: "fp-set-connect", goto: "fp-set-wifi", desc: "'Wi-Fi' 메뉴" },
    "fp-wifi-switch": { screen: "fp-set-wifi", effect: "wifiOn", desc: "Wi-Fi 켜기 스위치 (먼저 켜야 네트워크 목록이 보임)" },
    "fp-wifi-home": { screen: "fp-set-wifi", effect: "wifiConnect", desc: "'우리집 공유기' 네트워크 (Wi-Fi를 켠 뒤에만 누를 수 있음)" },

    "fp-kakao-daughter": { screen: "fp-kakao-list", goto: "fp-kakao-room", desc: "'사랑하는 딸' 채팅방" },
    "fp-kakao-plus": { screen: "fp-kakao-room", goto: "fp-kakao-attach", desc: "채팅방 왼쪽 아래 더하기(+) 버튼" },
    "fp-attach-album": { screen: "fp-kakao-attach", goto: "fp-kakao-album", desc: "'앨범' 버튼" },
    "fp-photo-1": { screen: "fp-kakao-album", effect: "photoSel", desc: "앨범의 첫 번째 사진" },
    "fp-album-send": { screen: "fp-kakao-album", effect: "photoSend", goto: "fp-kakao-room", desc: "'전송' 버튼 (사진을 먼저 선택해야 함)" },
  };

  // 요소를 눌렀을 때 가상 폰에 일어나는 효과
  const EFFECTS = {
    fontSel(id) {
      document.querySelectorAll(".fp-size").forEach((b) => b.classList.remove("on"));
      $(id).classList.add("on");
      $("fp-sample").classList.toggle("big", id === "fp-size-large");
    },
    muteToggle() {
      const sw = $("fp-mute-switch");
      sw.classList.toggle("on");
      $("fp-mute-state").textContent = sw.classList.contains("on") ? "켜짐" : "꺼짐";
    },
    volSel(id) {
      ["fp-vol-small", "fp-vol-mid", "fp-vol-big"].forEach((v) => $(v).classList.remove("on"));
      $(id).classList.add("on");
    },
    timeoutSel(id) {
      ["fp-timeout-30", "fp-timeout-60", "fp-timeout-300"].forEach((v) => $(v).classList.remove("on"));
      $(id).classList.add("on");
      $("fp-timeout-state").textContent = $(id).textContent;
    },
    wifiOn() {
      $("fp-wifi-switch").classList.add("on");
      $("fp-wifi-list").classList.remove("hidden");
      $("fp-wifi-state").textContent = "켜짐";
    },
    wifiConnect() { $("fp-wifi-home-state").textContent = "연결됨"; },
    photoSel() { $("fp-photo-1").classList.add("selected"); },
    photoSend() {
      const photo = document.createElement("div");
      photo.className = "fp-bubble me photo p1-bg";
      photo.dataset.practice = "1";
      $("fp-msgs").appendChild(photo);
    },
  };

  // ---------- AI 튜토리얼 설계 ----------
  // 하드코딩된 시나리오는 없다. 모든 연습 순서는 AI가 UI 지도를 보고 설계한다.
  const uiGraphText = () => Object.entries(ELEMENTS)
    .map(([id, el]) => `- ${id} (화면: ${el.screen}): ${el.desc}${el.goto ? ` → 누르면 ${el.goto} 화면으로 이동` : ""}`)
    .join("\n");

  const PLAN_PROMPT = (request, feedback) => `당신은 할머니 할아버지께 스마트폰을 가르쳐드리는 다정한 손주 AI이자 튜토리얼 설계자입니다.
아래는 연습용 가상 스마트폰의 전체 UI 지도입니다. 시작 화면은 항상 fp-home(홈)입니다.

${uiGraphText()}

어르신의 부탁: "${request}"
${feedback ? `\n(이전 설계의 문제: ${feedback} — 반드시 고쳐서 다시 설계하세요)` : ""}

이 가상 폰에서 부탁을 이루는 단계를 순서대로 설계하세요. 규칙:
1. target은 반드시 위 지도에 있는 id만 사용
2. 각 단계의 target은 그 시점에 보이는 화면에 있어야 함 (홈에서 시작해 goto를 따라 이동)
3. say는 어르신께 드리는 아주 쉬운 한 문장
4. 가상 폰에 없는 기능이면 feasible을 false로 하고 이유를 적기

반드시 아래 JSON 형식으로만 답하세요.
{
  "feasible": true 또는 false,
  "reason": "불가능할 때만: 왜 안 되는지 + 비슷하게 연습할 수 있는 것 제안",
  "title": "연습 제목 (짧은 단어형)",
  "steps": [{"target": "요소 id", "say": "안내 문장"}],
  "done": "완주했을 때 해줄 칭찬과 설명 한두 문장"
}`;

  // AI가 짠 계획이 실제로 실행 가능한지 화면 이동을 시뮬레이션해 검증한다
  function validatePlan(plan) {
    if (!plan || !plan.feasible) return { ok: false, reason: plan?.reason || "설계 실패" };
    if (!Array.isArray(plan.steps) || !plan.steps.length) return { ok: false, reason: "단계가 비어 있음" };
    let screen = "fp-home";
    let wifiOn = false, photoSelected = false;
    for (const [i, step] of plan.steps.entries()) {
      const el = ELEMENTS[step.target];
      if (!el) return { ok: false, reason: `${i + 1}번째 target '${step.target}'는 지도에 없는 id` };
      if (el.screen !== screen) return { ok: false, reason: `${i + 1}번째 '${step.target}'는 ${el.screen} 화면에 있는데 현재 화면은 ${screen}` };
      if (step.target === "fp-wifi-home" && !wifiOn) return { ok: false, reason: "Wi-Fi를 켜기 전에 네트워크를 누르게 함" };
      if (step.target === "fp-album-send" && !photoSelected) return { ok: false, reason: "사진을 선택하기 전에 전송을 누르게 함" };
      if (step.target === "fp-wifi-switch") wifiOn = true;
      if (step.target === "fp-photo-1") photoSelected = true;
      if (el.goto) screen = el.goto;
    }
    return { ok: true };
  }

  async function buildAiPlan(request) {
    let feedback = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const plan = await callGemini([{ text: PLAN_PROMPT(request, feedback) }]);
      if (plan && plan.feasible === false) {
        throw new Error(plan.reason || "이 연습은 가상 폰에서 아직 할 수 없어요.");
      }
      const v = validatePlan(plan);
      if (v.ok) return plan;
      feedback = v.reason; // 문제점을 알려주고 한 번 더 설계시킨다
    }
    throw new Error("연습 순서를 만들지 못했어요. 조금 다르게 말해서 다시 부탁해주세요.");
  }

  // ---------- 실행 엔진 ----------
  let plan = null;
  let stepIdx = 0;
  let running = false;
  let missToastAt = 0;

  function switchFp(screenId) {
    document.querySelectorAll(".fp-screen").forEach((s) => s.classList.remove("active"));
    $(screenId).classList.add("active");
  }

  function clearTarget() {
    document.querySelectorAll(".fp-target").forEach((el) => el.classList.remove("fp-target"));
  }

  // 가상 폰 상태 초기화
  function resetPhone() {
    clearTarget();
    $("fp-congrats").classList.add("hidden");
    $("fp-sample").classList.remove("big");
    document.querySelectorAll(".fp-size").forEach((b) => b.classList.remove("on"));
    $("fp-size-mid").classList.add("on");
    $("fp-vol-mid").classList.add("on");
    $("fp-timeout-60").classList.add("on");
    $("fp-timeout-state").textContent = "1분";
    $("fp-mute-switch").classList.remove("on");
    $("fp-mute-state").textContent = "꺼짐";
    $("fp-wifi-switch").classList.remove("on");
    $("fp-wifi-list").classList.add("hidden");
    $("fp-wifi-state").textContent = "꺼짐";
    $("fp-wifi-home-state").textContent = "잠김";
    $("fp-photo-1").classList.remove("selected");
    document.querySelectorAll('#fp-msgs [data-practice]').forEach((el) => el.remove());
    switchFp("fp-home");
  }

  function showStep() {
    const step = plan.steps[stepIdx];
    switchFp(ELEMENTS[step.target].screen);
    clearTarget();
    $(step.target).classList.add("fp-target");
    $("pb-step").textContent = `${stepIdx + 1} / ${plan.steps.length}`;
    $("pb-text").textContent = step.say;
    speakNow(step.say);
  }

  function finish() {
    running = false;
    clearTarget();
    $("pb-step").textContent = "완료";
    $("pb-text").textContent = "참 잘하셨어요!";
    $("congrats-desc").textContent = plan.done || "진짜 폰에서도 똑같이 해보세요!";
    $("fp-congrats").classList.remove("hidden");
    speakNow(`참 잘하셨어요! ${plan.done || ""}`);
  }

  function runPlan(p) {
    plan = p;
    stepIdx = 0;
    running = true;
    resetPhone();
    $("practice-select").classList.add("hidden");
    $("practice-loading").classList.add("hidden");
    $("practice-run").classList.remove("hidden");
    window.scrollTo(0, 0);
    showStep();
  }

  // 가상 폰 안의 모든 터치를 한 곳에서 판정
  $("fp-phone").addEventListener("click", (e) => {
    if (!running) return;
    const step = plan.steps[stepIdx];
    const hit = e.target.closest("#" + step.target);
    if (hit) {
      const el = ELEMENTS[step.target];
      if (el.effect) EFFECTS[el.effect](step.target);
      if (el.goto) switchFp(el.goto);
      stepIdx++;
      if (stepIdx >= plan.steps.length) finish();
      else showStep();
    } else if (e.target.closest(".fp-screen")) {
      const now = performance.now();
      if (now - missToastAt > 1600) {
        missToastAt = now;
        toast("괜찮아요! 빨간 표시 안을 눌러보세요");
      }
    }
  });

  // ---------- 진입점들 ----------
  // 예시 칩도 AI에게 보내는 부탁일 뿐 — 눌러도 AI가 설계한다
  document.querySelectorAll(".practice-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      $("practice-question").value = chip.textContent;
      $("practice-ask").click();
    });
  });

  $("practice-mic").addEventListener("click", () => startDictation($("practice-question"), $("practice-mic")));
  $("practice-question").addEventListener("keydown", (e) => { if (e.key === "Enter") $("practice-ask").click(); });

  $("practice-ask").addEventListener("click", async () => {
    const q = $("practice-question").value.trim();
    if (!q) { toast("하고 싶은 걸 말하거나 적어주세요"); return; }
    if (!requireKey()) return;
    try {
      $("practice-select").classList.add("hidden");
      $("practice-loading").classList.remove("hidden");
      const aiPlan = await buildAiPlan(q);
      runPlan(aiPlan);
    } catch (e) {
      $("practice-loading").classList.add("hidden");
      $("practice-select").classList.remove("hidden");
      toast(e.message, 5000);
    }
  });

  function exitToSelect() {
    running = false;
    window.speechSynthesis.cancel();
    resetPhone();
    $("practice-run").classList.add("hidden");
    $("practice-loading").classList.add("hidden");
    $("practice-select").classList.remove("hidden");
  }

  $("practice-exit").addEventListener("click", exitToSelect);
  $("practice-other").addEventListener("click", exitToSelect);
  $("practice-again").addEventListener("click", () => runPlan(plan));
})();
