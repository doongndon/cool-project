/* ============================================================
   연습 모드 — 가상 폰 위에 안내 UI를 띄워 직접 눌러보며 배우는 튜토리얼
   빨간 표시(스포트라이트)가 눌러야 할 곳을 짚어주고,
   맞게 누르면 다음 단계로 넘어간다. 잘못 눌러도 안전하다.
   ============================================================ */

"use strict";

(function () {
  const $ = (id) => document.getElementById(id);

  // ---------- 시나리오 정의 ----------
  // 각 단계: 보여줄 가상 화면(screen), 눌러야 할 요소(target), 안내말(say),
  // 누른 직후 실행할 효과(after)
  const SCENARIOS = {
    font: {
      title: "글자 크게 하기",
      done: "이제 진짜 폰에서도 똑같이 하시면 돼요!",
      steps: [
        { screen: "fp-home", target: "fp-app-settings", say: "설정 앱을 누르세요" },
        { screen: "fp-set-main", target: "fp-row-display", say: "'디스플레이'를 누르세요" },
        { screen: "fp-set-display", target: "fp-row-fontsize", say: "'글자 크기'를 누르세요" },
        { screen: "fp-set-fontsize", target: "fp-size-large", say: "'크게'를 누르세요",
          after: () => {
            $("fp-sample").classList.add("big");
            document.querySelectorAll(".fp-size").forEach((b) => b.classList.remove("on"));
            $("fp-size-large").classList.add("on");
          } },
      ],
    },
    kakao: {
      title: "카카오톡 사진 보내기",
      done: "딸에게 사진이 갔어요! 진짜 폰에서도 순서는 똑같아요.",
      steps: [
        { screen: "fp-home", target: "fp-app-kakao", say: "카카오톡을 누르세요" },
        { screen: "fp-kakao-list", target: "fp-kakao-daughter", say: "'사랑하는 딸'을 누르세요" },
        { screen: "fp-kakao-room", target: "fp-kakao-plus", say: "왼쪽 아래 더하기(+)를 누르세요" },
        { screen: "fp-kakao-attach", target: "fp-attach-album", say: "'앨범'을 누르세요" },
        { screen: "fp-kakao-album", target: "fp-photo-1", say: "보낼 사진을 누르세요",
          after: () => $("fp-photo-1").classList.add("selected") },
        { screen: "fp-kakao-album", target: "fp-album-send", say: "'전송'을 누르세요",
          after: () => {
            const photo = document.createElement("div");
            photo.className = "fp-bubble me photo p1-bg";
            photo.dataset.practice = "1";
            $("fp-msgs").appendChild(photo);
            switchFp("fp-kakao-room");
          } },
      ],
    },
    wifi: {
      title: "와이파이 연결하기",
      done: "와이파이에 연결됐어요! 데이터 요금 걱정 없이 쓰세요.",
      steps: [
        { screen: "fp-home", target: "fp-app-settings", say: "설정 앱을 누르세요" },
        { screen: "fp-set-main", target: "fp-row-connect", say: "'연결'을 누르세요" },
        { screen: "fp-set-connect", target: "fp-row-wifi", say: "'Wi-Fi'를 누르세요" },
        { screen: "fp-set-wifi", target: "fp-wifi-switch", say: "스위치를 눌러 와이파이를 켜세요",
          after: () => {
            $("fp-wifi-switch").classList.add("on");
            $("fp-wifi-list").classList.remove("hidden");
            $("fp-wifi-state").textContent = "켜짐";
          } },
        { screen: "fp-set-wifi", target: "fp-wifi-home", say: "'우리집 공유기'를 누르세요",
          after: () => { $("fp-wifi-home-state").textContent = "연결됨"; } },
      ],
    },
  };

  let scenario = null;
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

  // 가상 폰 상태를 처음으로 되돌린다
  function resetPhone() {
    clearTarget();
    $("fp-congrats").classList.add("hidden");
    $("fp-sample").classList.remove("big");
    document.querySelectorAll(".fp-size").forEach((b) => b.classList.remove("on"));
    document.querySelectorAll(".fp-size")[1].classList.add("on");
    $("fp-wifi-switch").classList.remove("on");
    $("fp-wifi-list").classList.add("hidden");
    $("fp-wifi-state").textContent = "꺼짐";
    $("fp-wifi-home-state").textContent = "잠김";
    $("fp-photo-1").classList.remove("selected");
    document.querySelectorAll('#fp-msgs [data-practice]').forEach((el) => el.remove());
    switchFp("fp-home");
  }

  function showStep() {
    const step = scenario.steps[stepIdx];
    switchFp(step.screen);
    clearTarget();
    $(step.target).classList.add("fp-target");
    $("pb-step").textContent = `${stepIdx + 1} / ${scenario.steps.length}`;
    $("pb-text").textContent = step.say;
    speak(step.say);
  }

  function finish() {
    running = false;
    clearTarget();
    $("pb-step").textContent = "완료";
    $("pb-text").textContent = "참 잘하셨어요!";
    $("congrats-desc").textContent = scenario.done;
    $("fp-congrats").classList.remove("hidden");
    speak(`참 잘하셨어요! ${scenario.done}`);
  }

  function startScenario(key) {
    scenario = SCENARIOS[key];
    if (!scenario) return;
    stepIdx = 0;
    running = true;
    resetPhone();
    $("practice-select").classList.add("hidden");
    $("practice-run").classList.remove("hidden");
    window.scrollTo(0, 0);
    showStep();
  }

  // 가상 폰 안에서의 모든 터치를 한 곳에서 판정한다
  $("fp-phone").addEventListener("click", (e) => {
    if (!running) return;
    const step = scenario.steps[stepIdx];
    const hit = e.target.closest("#" + step.target);
    if (hit) {
      if (step.after) step.after();
      stepIdx++;
      if (stepIdx >= scenario.steps.length) finish();
      else showStep();
    } else if (e.target.closest(".fp-screen")) {
      // 잘못 눌렀을 때: 너무 자주 뜨지 않게 안내
      const now = performance.now();
      if (now - missToastAt > 1600) {
        missToastAt = now;
        toast("괜찮아요! 빨간 표시 안을 눌러보세요");
      }
    }
  });

  document.querySelectorAll("[data-scenario]").forEach((btn) => {
    btn.addEventListener("click", () => startScenario(btn.dataset.scenario));
  });

  function exitToSelect() {
    running = false;
    window.speechSynthesis.cancel();
    resetPhone();
    $("practice-run").classList.add("hidden");
    $("practice-select").classList.remove("hidden");
  }

  $("practice-exit").addEventListener("click", exitToSelect);
  $("practice-other").addEventListener("click", exitToSelect);
  $("practice-again").addEventListener("click", () => {
    const key = Object.keys(SCENARIOS).find((k) => SCENARIOS[k] === scenario);
    startScenario(key);
  });
})();
