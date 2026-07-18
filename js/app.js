/* ============================================================
   AI 손주 — 어르신 디지털 도우미
   - Gemini API(무료)로 서류 해석 + 폰 화면 인식 안내 + 사기 검사
   - 키/기록은 localStorage에만 저장 (서버 없음, 개인정보 전송 없음)
   ============================================================ */

"use strict";

// ---------- 설정 ----------
// 무료 등급에서 쓸 수 있는 모델을 순서대로 시도한다 (404/미지원이면 다음 모델로)
const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const KEY_STORAGE = "ai_sonju_gemini_key";
const FONT_STORAGE = "ai_sonju_font_scale";
const SPEED_STORAGE = "ai_sonju_tts_rate";
const HISTORY_STORAGE = "ai_sonju_history";
const HISTORY_MAX = 20;

const $ = (id) => document.getElementById(id);

// ---------- 화면 전환 ----------
function goScreen(name) {
  window.speechSynthesis.cancel();
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $("screen-" + name).classList.add("active");
  if (name === "history") renderHistoryList();
  window.scrollTo(0, 0);
}
document.querySelectorAll("[data-go]").forEach((btn) => {
  btn.addEventListener("click", () => goScreen(btn.dataset.go));
});

// ---------- 글자 크기 (선택을 저장해서 다음에도 유지) ----------
function applyFontScale(scale) {
  document.documentElement.style.setProperty("--scale", scale);
  document.querySelectorAll(".font-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.scale === scale));
}
document.querySelectorAll(".font-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    localStorage.setItem(FONT_STORAGE, btn.dataset.scale);
    applyFontScale(btn.dataset.scale);
  });
});
applyFontScale(localStorage.getItem(FONT_STORAGE) || "1.15");

// ---------- 읽기 속도 ----------
function applySpeed(rate) {
  document.querySelectorAll(".speed-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.rate === rate));
}
document.querySelectorAll(".speed-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    localStorage.setItem(SPEED_STORAGE, btn.dataset.rate);
    applySpeed(btn.dataset.rate);
  });
});
applySpeed(localStorage.getItem(SPEED_STORAGE) || "0.95");

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
  // 저장된 키가 없으면 config.js(로컬 전용, git 제외)의 기본 키를 사용
  return localStorage.getItem(KEY_STORAGE) || window.AI_SONJU_DEFAULT_KEY || "";
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
  toast("저장했어요! 이제 사용하실 수 있어요");
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
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("사진 형식을 읽지 못했어요. 화면 캡처(스크린샷)나 일반 사진(JPG)을 올려주세요.")); };
    img.src = url;
  });
}

// 기록 저장용 저용량 썸네일 (localStorage 용량 보호)
function shrinkDataUrl(dataUrl, maxSize = 640) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve({ dataUrl: canvas.toDataURL("image/jpeg", 0.7), width: canvas.width, height: canvas.height });
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// ---------- Gemini 호출 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGemini(parts, { json = true } = {}) {
  const key = getKey();
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: json ? { responseMimeType: "application/json", temperature: 0.3 } : { temperature: 0.3 },
  };

  let lastErr = null;
  for (const model of MODELS) {
    // 무료 사용량 초과(429)는 잠깐 쉬었다 자동으로 한 번 더 시도한다
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let res;
        try {
          res = await fetch(`${API_BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
        } catch (_) {
          // fetch 자체가 실패하면 영어 오류 대신 쉬운 안내를 보여준다
          throw new Error("인터넷 연결이 안 되는 것 같아요. 와이파이나 데이터를 확인하고 다시 눌러주세요.");
        }
        if (res.status === 404) { lastErr = new Error("model-not-found"); break; }
        if (res.status === 429) {
          if (attempt === 0) { toast("사용량이 많아 잠시 기다렸다 다시 해볼게요..."); await sleep(3000); continue; }
          throw new Error("무료 사용량을 잠시 다 썼어요. 1분 뒤에 다시 눌러주세요.");
        }
        if (res.status === 400 || res.status === 403) {
          const detail = await res.json().catch(() => ({}));
          const msg = detail?.error?.message || "";
          if (/api key/i.test(msg)) throw new Error("키가 올바르지 않아요. 설정에서 다시 붙여넣어 주세요.");
          lastErr = new Error("요청이 거절되었어요. 다시 한 번 눌러주세요.");
          break;
        }
        if (!res.ok) throw new Error(`서버 오류(${res.status})가 났어요. 다시 한 번 눌러주세요.`);

        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
        if (!text) throw new Error("답을 받지 못했어요. 다시 한 번 눌러주세요.");
        return json ? parseJsonSafe(text) : text;
      } catch (e) {
        if (e.message === "model-not-found") break;
        throw e;
      }
    }
  }
  throw lastErr || new Error("사용할 수 있는 모델을 찾지 못했어요. 잠시 후 다시 해주세요.");
}

// 모델이 ```json 코드블록이나 설명 문장으로 감싸는 경우까지 대비해 JSON만 뽑아낸다
function parseJsonSafe(text) {
  const stripped = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(stripped); } catch (_) { /* 아래에서 재시도 */ }
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(stripped.slice(start, end + 1)); } catch (_) { /* 아래로 */ }
  }
  throw new Error("답을 정리하다 문제가 생겼어요. 한 번만 다시 눌러주세요.");
}

// ---------- 음성 (TTS / STT) ----------
// 크롬(안드로이드)은 한 번에 긴 문장을 읽으면 15초쯤에서 뚝 끊긴다.
// 문장 단위로 잘라 이어 읽게 해서 해결. 읽는 중에 다시 누르면 멈춘다.
function speak(text) {
  const synth = window.speechSynthesis;
  if (!synth) { toast("이 브라우저는 소리 읽기를 지원하지 않아요"); return; }
  if (synth.speaking || synth.pending) { synth.cancel(); toast("읽기를 멈췄어요"); return; }

  const rate = parseFloat(localStorage.getItem(SPEED_STORAGE) || "0.95");
  const sentences = text.match(/[^.!?\n]+[.!?\n]?/g) || [text];
  // 너무 잘게 쪼개지 않도록 140자 안에서 문장을 다시 묶는다
  const chunks = [];
  let buf = "";
  for (const s of sentences) {
    if ((buf + s).length > 140 && buf) { chunks.push(buf); buf = s; }
    else buf += s;
  }
  if (buf.trim()) chunks.push(buf);

  chunks.forEach((chunk) => {
    const utter = new SpeechSynthesisUtterance(chunk.trim());
    utter.lang = "ko-KR";
    utter.rate = rate;
    synth.speak(utter);
  });
}

function startDictation(inputEl, micBtn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast("이 브라우저는 음성 입력을 지원하지 않아요. 글자로 적어주세요."); return; }
  const rec = new SR();
  rec.lang = "ko-KR";
  rec.interimResults = false;
  micBtn.classList.add("listening");
  toast("듣고 있어요, 말씀하세요");
  rec.onresult = (e) => { inputEl.value = e.results[0][0].transcript; };
  rec.onend = () => micBtn.classList.remove("listening");
  rec.onerror = () => { micBtn.classList.remove("listening"); toast("잘 못 들었어요. 다시 눌러주세요."); };
  rec.start();
}

// ---------- 공유 (가족에게) ----------
async function shareText(text) {
  if (navigator.share) {
    try { await navigator.share({ text }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("내용을 복사했어요. 카카오톡이나 문자에 붙여넣어 보내세요.");
  } catch (_) {
    toast("공유하기가 지원되지 않는 브라우저예요.");
  }
}

// ---------- 지난 기록 ----------
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_STORAGE)) || []; }
  catch (_) { return []; }
}
function saveHistoryEntry(entry) {
  const list = loadHistory();
  list.unshift(entry);
  const trimmed = list.slice(0, HISTORY_MAX);
  try {
    localStorage.setItem(HISTORY_STORAGE, JSON.stringify(trimmed));
  } catch (_) {
    // 용량 초과 시 이미지 없이 저장, 그래도 안 되면 오래된 것부터 버린다
    trimmed.forEach((e) => delete e.img);
    try { localStorage.setItem(HISTORY_STORAGE, JSON.stringify(trimmed.slice(0, 10))); } catch (_) { /* 저장 포기 */ }
  }
}
const HISTORY_META = {
  doc:   { icon: "#i-doc",    cls: "blue",  label: "서류 해석" },
  phone: { icon: "#i-phone",  cls: "green", label: "폰 사용법" },
  scam:  { icon: "#i-shield", cls: "red",   label: "사기 검사" },
};
function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function renderHistoryList() {
  const list = loadHistory();
  const wrap = $("history-list");
  wrap.innerHTML = "";
  $("history-empty").classList.toggle("hidden", list.length > 0);
  list.forEach((entry, idx) => {
    const meta = HISTORY_META[entry.type];
    if (!meta) return;
    const btn = document.createElement("button");
    btn.className = "history-item";
    btn.innerHTML =
      `<span class="card-ic ${meta.cls}"><svg class="ic"><use href="${meta.icon}"/></svg></span>` +
      `<span class="card-body"><span class="hist-title"></span>` +
      `<span class="hist-date">${meta.label} · ${formatDate(entry.ts)}</span></span>` +
      `<svg class="ic card-chevron"><use href="#i-chevron"/></svg>`;
    btn.querySelector(".hist-title").textContent = entry.title || meta.label;
    btn.addEventListener("click", () => openHistoryEntry(idx));
    wrap.appendChild(btn);
  });
}
function openHistoryEntry(idx) {
  const entry = loadHistory()[idx];
  if (!entry) return;
  if (entry.type === "doc") {
    goScreen("doc");
    $("doc-start").classList.add("hidden");
    renderDocResult(entry.data, entry.img ? entry.img.dataUrl : "");
  } else if (entry.type === "phone") {
    goScreen("phone");
    $("phone-start").classList.add("hidden");
    renderPhoneResult(entry.data, entry.img || null);
  } else if (entry.type === "scam") {
    goScreen("scam");
    $("scam-start").classList.add("hidden");
    renderScamResult(entry.data);
  }
}
$("history-clear").addEventListener("click", () => {
  if (!loadHistory().length) { toast("지울 기록이 없어요"); return; }
  localStorage.removeItem(HISTORY_STORAGE);
  renderHistoryList();
  toast("기록을 모두 지웠어요");
});

// ============================================================
// 기능 1: 서류 해석
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

function docShareText(data) {
  return `[AI 손주 - 서류 해석]\n` +
    `${data.doc_type}\n\n요약: ${data.summary}\n\n` +
    ((data.warnings || []).length ? `주의사항:\n- ${data.warnings.join("\n- ")}\n\n` : "") +
    ((data.must_know || []).length ? `핵심 정보:\n- ${data.must_know.join("\n- ")}` : "");
}

function renderDocResult(data, previewUrl) {
  $("doc-loading").classList.add("hidden");
  $("doc-result").classList.remove("hidden");
  $("doc-answer").classList.add("hidden");
  $("doc-question").value = "";

  $("doc-preview").src = previewUrl || "";
  $("doc-preview").style.display = previewUrl ? "" : "none";
  $("doc-type").textContent = data.doc_type || "";
  $("doc-summary").textContent = data.summary || "";
  fillList("doc-warnings", data.warnings, "특별히 조심할 내용은 없어 보여요");
  fillList("doc-mustknow", data.must_know, "-");

  const dl = $("doc-words");
  dl.innerHTML = "";
  (data.words || []).forEach((w) => {
    const dt = document.createElement("dt");
    dt.textContent = w.word;
    const dd = document.createElement("dd");
    dd.textContent = w.meaning;
    dl.append(dt, dd);
  });

  const speech = `이 서류는요, ${data.doc_type} ${data.summary} ` +
    ((data.warnings || []).length ? `조심하세요! ${data.warnings.join(". ")}` : "");
  $("doc-tts").onclick = () => speak(speech);
  $("doc-share").onclick = () => shareText(docShareText(data));
}

async function analyzeDoc(file) {
  if (!requireKey()) return;
  try {
    $("doc-start").classList.add("hidden");
    $("doc-result").classList.add("hidden");
    $("doc-loading").classList.remove("hidden");

    const img = await fileToResizedBase64(file);
    docImageBase64 = img.base64;

    const result = await callGemini([
      { text: DOC_PROMPT },
      { inlineData: { mimeType: "image/jpeg", data: img.base64 } },
    ]);

    renderDocResult(result, img.dataUrl);

    const thumb = await shrinkDataUrl(img.dataUrl);
    saveHistoryEntry({ type: "doc", ts: Date.now(), title: result.doc_type, data: result, img: thumb });
  } catch (e) {
    $("doc-loading").classList.add("hidden");
    $("doc-start").classList.remove("hidden");
    toast(e.message);
  }
}

$("doc-camera").addEventListener("change", (e) => e.target.files[0] && analyzeDoc(e.target.files[0]));
$("doc-file").addEventListener("change", (e) => e.target.files[0] && analyzeDoc(e.target.files[0]));
$("doc-restart").addEventListener("click", () => {
  window.speechSynthesis.cancel();
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
  if (!requireKey()) return;
  if (!docImageBase64) {
    // 기록에서 열었을 때는 화면의 썸네일로 다시 질문한다
    const src = $("doc-preview").src;
    if (src.startsWith("data:")) docImageBase64 = src.split(",")[1];
    else { toast("사진이 없어서 질문할 수 없어요. 서류를 다시 찍어주세요."); return; }
  }
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
$("doc-question").addEventListener("keydown", (e) => { if (e.key === "Enter") $("doc-ask").click(); });

// ============================================================
// 기능 2: 폰 사용법 (화면 인식 + "여기를 누르세요")
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
  $("phone-shot-name").textContent = phoneShotFile ? `화면 캡처 준비 완료: ${phoneShotFile.name}` : "";
});

document.querySelectorAll(".example-chip").forEach((chip) => {
  chip.addEventListener("click", () => { $("phone-question").value = chip.textContent; });
});

$("phone-mic").addEventListener("click", () => startDictation($("phone-question"), $("phone-mic")));

function phoneShareText(data) {
  return `[AI 손주 - 폰 사용법]\n${data.answer}\n\n따라하기:\n` +
    (data.steps || []).map((s, i) => `${i + 1}. ${s}`).join("\n");
}

function renderPhoneResult(data, shotImg) {
  $("phone-loading").classList.add("hidden");
  $("phone-result").classList.remove("hidden");

  $("phone-answer").textContent = data.answer || "";

  const ol = $("phone-steps");
  ol.innerHTML = "";
  (data.steps || []).forEach((s) => {
    const li = document.createElement("li");
    li.textContent = s;
    ol.appendChild(li);
  });

  // "여기를 누르세요" 표시 (좌표가 4개 숫자로 온전할 때만)
  if (shotImg && data.tap && Array.isArray(data.tap.box_2d) &&
      data.tap.box_2d.length === 4 && data.tap.box_2d.every((n) => typeof n === "number")) {
    drawTapMarker(shotImg, data.tap);
    $("phone-canvas-wrap").classList.remove("hidden");
  } else {
    $("phone-canvas-wrap").classList.add("hidden");
  }

  const speech = `${data.answer} 순서를 알려드릴게요. ${(data.steps || []).map((s, i) => `${i + 1}번. ${s}`).join(" ")}`;
  $("phone-tts").onclick = () => speak(speech);
  $("phone-share").onclick = () => shareText(phoneShareText(data));
}

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

    renderPhoneResult(result, shotImg);

    const thumb = shotImg ? await shrinkDataUrl(shotImg.dataUrl) : null;
    saveHistoryEntry({ type: "phone", ts: Date.now(), title: q, data: result, img: thumb });
  } catch (e) {
    $("phone-loading").classList.add("hidden");
    $("phone-start").classList.remove("hidden");
    toast(e.message);
  }
});
$("phone-question").addEventListener("keydown", (e) => { if (e.key === "Enter") $("phone-ask").click(); });

// 캡처 위에 스포트라이트 + 원 + 화살표로 누를 곳 표시
function drawTapMarker(img, tap) {
  const canvas = $("phone-canvas");
  const image = new Image();
  image.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);

    const clamp = (n) => Math.min(1000, Math.max(0, n));
    const [ymin, xmin, ymax, xmax] = tap.box_2d.map(clamp);
    const cx = ((xmin + xmax) / 2 / 1000) * img.width;
    const cy = ((ymin + ymax) / 2 / 1000) * img.height;
    const r = Math.min(
      Math.max(((xmax - xmin) / 1000) * img.width, ((ymax - ymin) / 1000) * img.height) / 2 + 18,
      img.width * 0.45 // 좌표가 이상하게 커도 원이 화면을 덮지 않게
    );

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
    ctx.strokeStyle = "#e5484d";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // 원 아래에서 위로 가리키는 화살표
    const arrowTop = cy + r + 6;
    const arrowLen = Math.min(canvas.width * 0.13, canvas.height - arrowTop - 10);
    if (arrowLen > 20) {
      const headH = arrowLen * 0.45;
      const headW = headH * 0.9;
      ctx.fillStyle = "#e5484d";
      ctx.strokeStyle = "#e5484d";
      ctx.beginPath();
      ctx.moveTo(cx, arrowTop);
      ctx.lineTo(cx - headW / 2, arrowTop + headH);
      ctx.lineTo(cx + headW / 2, arrowTop + headH);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = Math.max(6, canvas.width * 0.018);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx, arrowTop + headH);
      ctx.lineTo(cx, arrowTop + arrowLen);
      ctx.stroke();
    }
    ctx.textAlign = "center";

    if (tap.label) {
      const fontSize = Math.round(canvas.width * 0.045);
      ctx.font = `bold ${fontSize}px sans-serif`;
      const label = `"${tap.label}" 을(를) 누르세요`;
      const tw = ctx.measureText(label).width;
      const pad = fontSize * 0.5;
      // 말풍선이 화면 밖으로 나가지 않게 좌우를 고정
      const lx = Math.min(Math.max(cx, tw / 2 + pad + 4), canvas.width - tw / 2 - pad - 4);
      const ly = Math.max(cy - r - fontSize * 1.2, fontSize * 1.6);
      ctx.fillStyle = "#e5484d";
      roundRect(ctx, lx - tw / 2 - pad, ly - fontSize * 1.15, tw + pad * 2, fontSize * 1.7, 10);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(label, lx, ly);
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
  window.speechSynthesis.cancel();
  $("phone-result").classList.add("hidden");
  $("phone-start").classList.remove("hidden");
  $("phone-question").value = "";
  $("phone-shot").value = "";
  phoneShotFile = null;
  $("phone-shot-name").textContent = "";
});

// ============================================================
// 기능 3: 사기 검사 (보이스피싱·스미싱 판별)
// ============================================================

const SCAM_PROMPT = (text) => `당신은 할머니 할아버지를 보이스피싱과 스미싱(문자 사기)에서 지켜드리는 손주 AI입니다.
${text ? `어르신이 받은 문자나 전화 내용: "${text}"` : "첨부된 이미지는 어르신이 받은 문자 화면 캡처입니다."}

정부기관·검찰·경찰 사칭, 가족 사칭("엄마 나 폰 고장났어"), 택배·부고·건강검진 링크,
대출·환급·지원금 미끼, 앱 설치 유도, 개인정보·계좌·송금 요구 같은 대표 사기 수법인지 판별하세요.
반드시 아래 JSON 형식으로만, 아주 쉬운 한국어로 답하세요.

{
  "verdict": "danger(사기가 거의 확실) | warning(사기일 수 있으니 주의) | safe(사기 신호 없음) 중 하나",
  "title": "결론 한 문장 (예: 가족을 사칭한 사기 문자예요!)",
  "reasons": ["왜 그렇게 판단했는지 쉬운 말로 2~4개"],
  "advice": ["어르신이 지금 해야 할 행동을 순서대로 2~4개 (예: 절대 링크를 누르지 마세요)"]
}`;

const VERDICT_STYLE = {
  danger: { icon: "#i-danger", cls: "danger", fallbackTitle: "사기일 가능성이 매우 높아요!" },
  warning: { icon: "#i-warn", cls: "warning", fallbackTitle: "사기일 수 있어요. 조심하세요!" },
  safe: { icon: "#i-check", cls: "safe", fallbackTitle: "사기 신호는 보이지 않아요" },
};

let scamShotFile = null;

$("scam-shot").addEventListener("change", (e) => {
  scamShotFile = e.target.files[0] || null;
  $("scam-shot-name").textContent = scamShotFile ? `캡처 준비 완료: ${scamShotFile.name}` : "";
});

function scamShareText(data) {
  const style = VERDICT_STYLE[data.verdict] || VERDICT_STYLE.warning;
  return `[AI 손주 - 사기 검사]\n${data.title || style.fallbackTitle}\n\n` +
    `판단 근거:\n- ${(data.reasons || []).join("\n- ")}\n\n` +
    `행동 요령:\n- ${(data.advice || []).join("\n- ")}`;
}

function renderScamResult(data) {
  $("scam-loading").classList.add("hidden");
  $("scam-result").classList.remove("hidden");

  const style = VERDICT_STYLE[data.verdict] || VERDICT_STYLE.warning;
  $("scam-verdict").className = "verdict-card " + style.cls;
  $("scam-verdict-use").setAttribute("href", style.icon);
  $("scam-verdict-title").textContent = data.title || style.fallbackTitle;

  fillList("scam-reasons", data.reasons, "-");
  fillList("scam-advice", data.advice, "-");

  const speech = `${data.title || style.fallbackTitle} ` +
    `이유를 말씀드릴게요. ${(data.reasons || []).join(". ")} ` +
    `이렇게 하세요. ${(data.advice || []).join(". ")}`;
  $("scam-tts").onclick = () => speak(speech);
  $("scam-share").onclick = () => shareText(scamShareText(data));
}

$("scam-check").addEventListener("click", async () => {
  const text = $("scam-text").value.trim();
  if (!text && !scamShotFile) { toast("문자 내용을 붙여넣거나 캡처를 올려주세요"); return; }
  if (!requireKey()) return;

  try {
    $("scam-start").classList.add("hidden");
    $("scam-result").classList.add("hidden");
    $("scam-loading").classList.remove("hidden");

    const parts = [{ text: SCAM_PROMPT(text) }];
    if (scamShotFile) {
      const img = await fileToResizedBase64(scamShotFile);
      parts.push({ inlineData: { mimeType: "image/jpeg", data: img.base64 } });
    }
    const result = await callGemini(parts);

    renderScamResult(result);
    saveHistoryEntry({ type: "scam", ts: Date.now(), title: result.title, data: result });
  } catch (e) {
    $("scam-loading").classList.add("hidden");
    $("scam-start").classList.remove("hidden");
    toast(e.message);
  }
});

$("scam-restart").addEventListener("click", () => {
  window.speechSynthesis.cancel();
  $("scam-result").classList.add("hidden");
  $("scam-start").classList.remove("hidden");
  $("scam-text").value = "";
  $("scam-shot").value = "";
  scamShotFile = null;
  $("scam-shot-name").textContent = "";
});

// ---------- 첫 실행 안내 ----------
if (!getKey()) {
  setTimeout(openSettings, 600);
}
