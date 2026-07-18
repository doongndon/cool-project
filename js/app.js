/* ============================================================
   AI 손주 — 어르신 디지털 도우미
   - Gemini API(무료)로 서류 요약 + 폰 화면 인식 튜토리얼
   - 키는 localStorage에만 저장 (서버 없음, 개인정보 전송 없음)
   ============================================================ */

"use strict";

// ---------- 설정 ----------
// 무료 등급에서 쓸 수 있는 모델을 순서대로 시도한다 (404/미지원이면 다음 모델로)
const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const KEY_STORAGE = "ai_sonju_gemini_key";

const $ = (id) => document.getElementById(id);

// ---------- 화면 전환 ----------
function goScreen(name) {
  window.speechSynthesis.cancel();
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $("screen-" + name).classList.add("active");
  window.scrollTo(0, 0);
}
document.querySelectorAll("[data-go]").forEach((btn) => {
  btn.addEventListener("click", () => goScreen(btn.dataset.go));
});

// ---------- 글자 크기 ----------
document.querySelectorAll(".font-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".font-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.documentElement.style.setProperty("--scale", btn.dataset.scale);
  });
});

// ---------- 토스트 ----------
let toastTimer = null;
function toast(msg, ms = 3500) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), ms);
}

// ---------- API 키 ----------
function getKey() {
  return localStorage.getItem(KEY_STORAGE) || "";
}
function openSettings() {
  $("api-key-input").value = getKey();
  $("settings-modal").classList.remove("hidden");
}
$("btn-settings").addEventListener("click", openSettings);
$("close-settings").addEventListener("click", () => $("settings-modal").classList.add("hidden"));
$("save-key").addEventListener("click", () => {
  const key = $("api-key-input").value.trim();
  if (!key) { toast("키를 입력해주세요"); return; }
  localStorage.setItem(KEY_STORAGE, key);
  $("settings-modal").classList.add("hidden");
  toast("저장했어요! 이제 사용하실 수 있어요 😊");
});
function requireKey() {
  if (!getKey()) {
    toast("먼저 무료 키를 한 번만 설정해주세요");
    openSettings();
    return false;
  }
  return true;
}

// ---------- 이미지 유틸 ----------
// 큰 사진은 폭 1280px로 줄여서 전송량과 응답 속도를 아낀다
function fileToResizedBase64(file, maxSize = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const ratio = Math.min(1, maxSize / Math.max(width, height));
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
      resolve({ base64: dataUrl.split(",")[1], dataUrl, width, height });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지를 읽지 못했어요")); };
    img.src = url;
  });
}

// ---------- Gemini 호출 ----------
async function callGemini(parts, { json = true } = {}) {
  const key = getKey();
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: json ? { responseMimeType: "application/json", temperature: 0.3 } : { temperature: 0.3 },
  };

  let lastErr = null;
  for (const model of MODELS) {
    try {
      const res = await fetch(`${API_BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 404) { lastErr = new Error("model-not-found"); continue; }
      if (res.status === 429) throw new Error("무료 사용량을 잠시 다 썼어요. 1분 뒤에 다시 눌러주세요.");
      if (res.status === 400 || res.status === 403) {
        const detail = await res.json().catch(() => ({}));
        const msg = detail?.error?.message || "";
        if (/api key/i.test(msg)) throw new Error("키가 올바르지 않아요. 설정(⚙️)에서 다시 붙여넣어 주세요.");
        lastErr = new Error(msg || "요청이 거절되었어요");
        continue;
      }
      if (!res.ok) throw new Error(`서버 오류(${res.status})가 났어요. 다시 한 번 눌러주세요.`);

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
      if (!text) throw new Error("답을 받지 못했어요. 다시 한 번 눌러주세요.");
      return json ? JSON.parse(cleanJson(text)) : text;
    } catch (e) {
      if (e.message === "model-not-found") { lastErr = e; continue; }
      throw e;
    }
  }
  throw lastErr || new Error("사용할 수 있는 모델을 찾지 못했어요");
}

// 모델이 ```json 코드블록으로 감싸는 경우 대비
function cleanJson(text) {
  return text.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();
}

// ---------- 음성 (TTS / STT) ----------
function speak(text) {
  const synth = window.speechSynthesis;
  if (!synth) { toast("이 브라우저는 소리 읽기를 지원하지 않아요"); return; }
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ko-KR";
  utter.rate = 0.9; // 어르신을 위해 약간 천천히
  synth.speak(utter);
}

function startDictation(inputEl, micBtn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast("이 브라우저는 음성 입력을 지원하지 않아요. 글자로 적어주세요."); return; }
  const rec = new SR();
  rec.lang = "ko-KR";
  rec.interimResults = false;
  micBtn.classList.add("listening");
  toast("듣고 있어요, 말씀하세요 🎤");
  rec.onresult = (e) => { inputEl.value = e.results[0][0].transcript; };
  rec.onend = () => micBtn.classList.remove("listening");
  rec.onerror = () => { micBtn.classList.remove("listening"); toast("잘 못 들었어요. 다시 눌러주세요."); };
  rec.start();
}

// ============================================================
// 기능 1: 어려운 서류 풀이
// ============================================================

const DOC_PROMPT = `당신은 할머니 할아버지를 돕는 다정한 손주 AI입니다.
사진 속 문서(계약서, 고지서, 안내문 등)를 읽고, 어려운 것을 하나도 모르는 어르신께 설명하듯 아주 쉬운 한국어로 정리하세요.
전문용어는 절대 그대로 쓰지 말고 풀어서 설명하세요. 반드시 아래 JSON 형식으로만 답하세요.

{
  "doc_type": "이 서류가 무엇인지 한 문장 (예: 휴대폰 판매 계약서예요)",
  "summary": "서류 전체 내용을 3~4문장의 아주 쉬운 말로 요약",
  "warnings": ["돈이 나가거나 불리할 수 있는 부분, 조심할 조항을 쉬운 말로. 없으면 빈 배열"],
  "must_know": ["꼭 기억해야 할 것 (금액, 날짜, 기간, 연락처 등)"],
  "words": [{"word": "서류에 나온 어려운 단어", "meaning": "쉬운 뜻풀이"}]
}`;

let docImageBase64 = null;

async function analyzeDoc(file) {
  if (!requireKey()) return;
  try {
    $("doc-start").classList.add("hidden");
    $("doc-result").classList.add("hidden");
    $("doc-loading").classList.remove("hidden");

    const img = await fileToResizedBase64(file);
    docImageBase64 = img.base64;
    $("doc-preview").src = img.dataUrl;

    const result = await callGemini([
      { text: DOC_PROMPT },
      { inlineData: { mimeType: "image/jpeg", data: img.base64 } },
    ]);

    $("doc-type").textContent = result.doc_type || "";
    $("doc-summary").textContent = result.summary || "";

    fillList("doc-warnings", result.warnings, "특별히 조심할 내용은 없어 보여요 😊");
    fillList("doc-mustknow", result.must_know, "-");

    const dl = $("doc-words");
    dl.innerHTML = "";
    (result.words || []).forEach((w) => {
      const dt = document.createElement("dt");
      dt.textContent = w.word;
      const dd = document.createElement("dd");
      dd.textContent = w.meaning;
      dl.append(dt, dd);
    });

    const speech = `이 서류는요, ${result.doc_type} ${result.summary} ` +
      ((result.warnings || []).length ? `조심하세요! ${result.warnings.join(". ")}` : "");
    $("doc-tts").onclick = () => speak(speech);

    $("doc-loading").classList.add("hidden");
    $("doc-result").classList.remove("hidden");
    $("doc-answer").classList.add("hidden");
    $("doc-question").value = "";
  } catch (e) {
    $("doc-loading").classList.add("hidden");
    $("doc-start").classList.remove("hidden");
    toast(e.message);
  }
}

function fillList(id, items, emptyText) {
  const ul = $(id);
  ul.innerHTML = "";
  const list = items && items.length ? items : [emptyText];
  list.forEach((t) => {
    const li = document.createElement("li");
    li.textContent = t;
    ul.appendChild(li);
  });
}

$("doc-camera").addEventListener("change", (e) => e.target.files[0] && analyzeDoc(e.target.files[0]));
$("doc-file").addEventListener("change", (e) => e.target.files[0] && analyzeDoc(e.target.files[0]));
$("doc-restart").addEventListener("click", () => {
  $("doc-result").classList.add("hidden");
  $("doc-start").classList.remove("hidden");
  $("doc-camera").value = "";
  $("doc-file").value = "";
});
$("doc-mic").addEventListener("click", () => startDictation($("doc-question"), $("doc-mic")));

// 서류에 대한 추가 질문
$("doc-ask").addEventListener("click", async () => {
  const q = $("doc-question").value.trim();
  if (!q) { toast("궁금한 것을 말하거나 적어주세요"); return; }
  if (!requireKey() || !docImageBase64) return;
  try {
    $("doc-ask").textContent = "생각하는 중...";
    const answer = await callGemini([
      { text: `사진 속 문서를 보고 어르신의 질문에 다정하고 아주 쉬운 한국어 2~3문장으로 답하세요. 질문: ${q}` },
      { inlineData: { mimeType: "image/jpeg", data: docImageBase64 } },
    ], { json: false });
    $("doc-answer-text").textContent = answer;
    $("doc-answer").classList.remove("hidden");
    $("doc-answer-tts").onclick = () => speak(answer);
  } catch (e) {
    toast(e.message);
  } finally {
    $("doc-ask").textContent = "질문하기";
  }
});

// ============================================================
// 기능 2: 폰 사용법 도우미 (화면 인식 + "여기를 누르세요")
// ============================================================

const PHONE_PROMPT_WITH_SHOT = (q) => `당신은 할머니 할아버지께 스마트폰 사용법을 알려드리는 다정한 손주 AI입니다.
첨부된 이미지는 어르신 스마트폰의 현재 화면 캡처입니다.
어르신의 질문: "${q}"

이 화면에서 시작해 목표를 이루는 방법을 아주 쉬운 한국어로 알려주세요.
지금 이 화면에서 눌러야 할 버튼이 보이면 그 위치를 정확히 짚어주세요.
반드시 아래 JSON 형식으로만 답하세요. box_2d는 [ymin, xmin, ymax, xmax] 순서이고 0~1000으로 정규화된 좌표입니다.

{
  "answer": "질문에 대한 다정한 한 두 문장 대답",
  "tap": {"label": "누를 버튼 이름", "box_2d": [ymin, xmin, ymax, xmax]} 또는 지금 화면에 누를 곳이 없으면 null,
  "steps": ["1단계부터 순서대로, 한 단계에 한 동작씩, 아주 쉬운 말로"]
}`;

const PHONE_PROMPT_NO_SHOT = (q) => `당신은 할머니 할아버지께 스마트폰 사용법을 알려드리는 다정한 손주 AI입니다.
어르신의 질문: "${q}"
(안드로이드 폰 기준, 화면 캡처는 없습니다)

반드시 아래 JSON 형식으로만 답하세요.
{
  "answer": "질문에 대한 다정한 한 두 문장 대답",
  "tap": null,
  "steps": ["1단계부터 순서대로, 한 단계에 한 동작씩, 아주 쉬운 말로"]
}`;

let phoneShotFile = null;

$("phone-shot").addEventListener("change", (e) => {
  phoneShotFile = e.target.files[0] || null;
  $("phone-shot-name").textContent = phoneShotFile ? `✅ 화면 캡처 준비 완료: ${phoneShotFile.name}` : "";
});

document.querySelectorAll(".example-chip").forEach((chip) => {
  chip.addEventListener("click", () => { $("phone-question").value = chip.textContent; });
});

$("phone-mic").addEventListener("click", () => startDictation($("phone-question"), $("phone-mic")));

$("phone-ask").addEventListener("click", async () => {
  const q = $("phone-question").value.trim();
  if (!q) { toast("무엇이 궁금한지 말하거나 적어주세요"); return; }
  if (!requireKey()) return;

  try {
    $("phone-start").classList.add("hidden");
    $("phone-result").classList.add("hidden");
    $("phone-loading").classList.remove("hidden");

    let result, shotImg = null;
    if (phoneShotFile) {
      shotImg = await fileToResizedBase64(phoneShotFile);
      result = await callGemini([
        { text: PHONE_PROMPT_WITH_SHOT(q) },
        { inlineData: { mimeType: "image/jpeg", data: shotImg.base64 } },
      ]);
    } else {
      result = await callGemini([{ text: PHONE_PROMPT_NO_SHOT(q) }]);
    }

    $("phone-answer").textContent = result.answer || "";

    const ol = $("phone-steps");
    ol.innerHTML = "";
    (result.steps || []).forEach((s) => {
      const li = document.createElement("li");
      li.textContent = s;
      ol.appendChild(li);
    });

    // "여기를 누르세요" 표시
    if (shotImg && result.tap && Array.isArray(result.tap.box_2d)) {
      drawTapMarker(shotImg, result.tap);
      $("phone-canvas-wrap").classList.remove("hidden");
    } else {
      $("phone-canvas-wrap").classList.add("hidden");
    }

    const speech = `${result.answer} 순서를 알려드릴게요. ${(result.steps || []).map((s, i) => `${i + 1}번. ${s}`).join(" ")}`;
    $("phone-tts").onclick = () => speak(speech);

    $("phone-loading").classList.add("hidden");
    $("phone-result").classList.remove("hidden");
  } catch (e) {
    $("phone-loading").classList.add("hidden");
    $("phone-start").classList.remove("hidden");
    toast(e.message);
  }
});

// 캡처 위에 빨간 동그라미 + 손가락으로 누를 곳 표시
function drawTapMarker(img, tap) {
  const canvas = $("phone-canvas");
  const image = new Image();
  image.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);

    const [ymin, xmin, ymax, xmax] = tap.box_2d;
    const cx = ((xmin + xmax) / 2 / 1000) * img.width;
    const cy = ((ymin + ymax) / 2 / 1000) * img.height;
    const r = Math.max(((xmax - xmin) / 1000) * img.width, ((ymax - ymin) / 1000) * img.height) / 2 + 18;

    // 화면 살짝 어둡게 → 누를 곳만 밝게 강조
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 빨간 원 테두리
    ctx.strokeStyle = "#e53e3e";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // 손가락 이모지와 라벨
    ctx.font = `${Math.round(canvas.width * 0.1)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("👆", cx, Math.min(cy + r + canvas.width * 0.11, canvas.height - 8));

    if (tap.label) {
      const fontSize = Math.round(canvas.width * 0.045);
      ctx.font = `bold ${fontSize}px sans-serif`;
      const label = `"${tap.label}" 을(를) 누르세요`;
      const tw = ctx.measureText(label).width;
      const ly = Math.max(cy - r - fontSize * 1.2, fontSize * 1.6);
      ctx.fillStyle = "#e53e3e";
      const pad = fontSize * 0.5;
      roundRect(ctx, cx - tw / 2 - pad, ly - fontSize * 1.15, tw + pad * 2, fontSize * 1.7, 10);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(label, cx, ly);
    }
  };
  image.src = img.dataUrl;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

$("phone-restart").addEventListener("click", () => {
  $("phone-result").classList.add("hidden");
  $("phone-start").classList.remove("hidden");
  $("phone-question").value = "";
  $("phone-shot").value = "";
  phoneShotFile = null;
  $("phone-shot-name").textContent = "";
});

// ---------- 첫 실행 안내 ----------
if (!getKey()) {
  setTimeout(openSettings, 600);
}
