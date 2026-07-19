/* ============================================================
   AI 손주 — 어르신 디지털 도우미
   - Gemini API(무료)로 서류 해석 + 폰 화면 인식 안내 + 사기 검사
   - 키/기록은 localStorage에만 저장 (서버 없음, 개인정보 전송 없음)
   ============================================================ */

"use strict";

// ---------- 설정 ----------
// 무료 등급에서 쓸 수 있는 모델을 순서대로 시도한다 (404/미지원이면 다음 모델로)
// Gemini 먼저(깔끔한 JSON) → 사용량 차면 Gemma로 자동 전환(무료 할당량 넉넉).
// Gemma는 JSON 강제 옵션을 무시하므로, 그 모델일 땐 프롬프트로 JSON을 유도하고
// 응답에서 JSON만 뽑아낸다(parseJsonSafe).
const MODELS = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash", "gemma-4-26b-a4b-it", "gemma-4-31b-it"];
const isGemma = (m) => m.startsWith("gemma");
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

// ---------- 로딩 문구 순환 ----------
// AI가 생각하는 동안 문구가 바뀌어서 "멈춘 게 아니에요"를 보여준다
let loadingTimer = null;
function startLoadingMsgs(panelId, msgs) {
  const el = document.querySelector(`#${panelId} .guide-text`);
  if (!el) return;
  let i = 0;
  el.textContent = msgs[0];
  clearInterval(loadingTimer);
  loadingTimer = setInterval(() => {
    i = (i + 1) % msgs.length;
    el.textContent = msgs[i];
  }, 2500);
}
function stopLoadingMsgs() {
  clearInterval(loadingTimer);
  loadingTimer = null;
}

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
// 구글 Gemini 키는 두 가지 형식이 있다: 예전 "AIza..."와 새 "AQ...."
const KEY_FMT = /^(AIza[0-9A-Za-z._-]{20,}|AQ\.[0-9A-Za-z._-]{20,})$/;
function getKey() {
  // 내 기기에 직접 저장한 키가 항상 최우선 — 내장 키가 죽어도 설정에서 바로 덮어쓸 수 있다
  const mine = (localStorage.getItem(KEY_STORAGE) || "").trim();
  if (mine) return mine;
  const embedded = (window.AI_SONJU_DEFAULT_KEY || "").trim();
  if (KEY_FMT.test(embedded)) return embedded;
  return "";
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
  loadDailyTip(); // 키가 생겼으니 오늘의 꿀팁도 바로 보여준다
});
function requireKey() {
  // 프록시 서버가 있으면 어르신은 키가 필요 없다
  if (window.AI_SONJU_PROXY_URL) return true;
  if (!getKey()) {
    toast("먼저 무료 키를 한 번만 설정해주세요");
    openSettings();
    return false;
  }
  return true;
}

// 죽은 내장 키를 무시하도록 표시하고, 새 키 입력창을 연다
let badKeyFlagged = false;
function keyIsBad() {
  if (badKeyFlagged) return;
  badKeyFlagged = true;
  // 내장 키가 죽었는데 내 저장 키가 없으면, 내장 키를 못 쓰게 막고 설정을 연다
  if (!localStorage.getItem(KEY_STORAGE)) {
    window.AI_SONJU_DEFAULT_KEY = "";
    setTimeout(openSettings, 400);
  }
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
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: json ? { responseMimeType: "application/json", temperature: 0.3 } : { temperature: 0.3 },
  };

  // 특정 모델용으로 요청 본문을 살짝 바꾼다 (Gemma는 responseMimeType 미지원)
  function bodyFor(model) {
    if (!isGemma(model)) return body;
    const gemmaParts = parts.map((p) => ({ ...p }));
    if (json) {
      const i = gemmaParts.findIndex((p) => typeof p.text === "string");
      if (i >= 0) gemmaParts[i] = { text: gemmaParts[i].text + "\n\n[중요] 다른 말은 절대 붙이지 말고 위 JSON만 출력하세요." };
    }
    return { contents: [{ role: "user", parts: gemmaParts }], generationConfig: { temperature: 0.2 } };
  }

  // 프록시 서버가 설정돼 있으면 그쪽으로 보낸다 (키가 서버에 숨겨져 있어 어르신은 아무것도 안 넣어도 됨)
  if (window.AI_SONJU_PROXY_URL) {
    let res;
    try {
      res = await fetch(window.AI_SONJU_PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (_) {
      throw new Error("인터넷 연결이 안 되는 것 같아요. 와이파이나 데이터를 확인하고 다시 눌러주세요.");
    }
    if (res.status === 429) throw new Error("지금 이용자가 많아요. 잠시 후 다시 눌러주세요.");
    if (!res.ok) throw new Error("잠시 문제가 생겼어요. 다시 한 번 눌러주세요.");
    const data = await res.json().catch(() => ({}));
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    if (!text) throw new Error("답을 받지 못했어요. 다시 한 번 눌러주세요.");
    return json ? parseJsonSafe(text) : text;
  }

  const key = getKey();
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
            body: JSON.stringify(bodyFor(model)),
          });
        } catch (_) {
          // fetch 자체가 실패하면 영어 오류 대신 쉬운 안내를 보여준다
          throw new Error("인터넷 연결이 안 되는 것 같아요. 와이파이나 데이터를 확인하고 다시 눌러주세요.");
        }
        // 없는 모델(404)이면 조용히 다음 모델로 넘어간다 (사용자에겐 안 보임)
        if (res.status === 404) { lastErr = new Error("잠시 문제가 생겼어요. 다시 한 번 눌러주세요."); break; }
        if (res.status === 429) {
          // 무료 사용량은 모델별로 따로다: 짧게 재시도해보고, 그래도 막히면 다음 모델로 갈아탄다
          if (attempt === 0) { toast("사용량이 많아 잠시 기다렸다 다시 해볼게요..."); await sleep(3000); continue; }
          lastErr = new Error("지금은 사용량이 가득 찼어요. 1~2분 뒤에 다시 해주세요.");
          const next = MODELS[MODELS.indexOf(model) + 1];
          if (next) toast("예비 모델로 바꿔볼게요...");
          break;
        }
        if (res.status === 400 || res.status === 403) {
          const detail = await res.json().catch(() => ({}));
          const msg = detail?.error?.message || "";
          // 키가 죽었거나(유출 신고·정지) 잘못된 경우: 설정을 열어 새 키를 넣게 안내
          if (/leaked|expired|invalid|api key|permission|not authorized|suspend/i.test(msg)) {
            keyIsBad();
            throw new Error("열쇠(키)가 막혔어요. 설정에서 새 키를 넣어주세요.");
          }
          lastErr = new Error("요청이 거절되었어요. 다시 한 번 눌러주세요.");
          break;
        }
        if (!res.ok) throw new Error(`서버 오류(${res.status})가 났어요. 다시 한 번 눌러주세요.`);

        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
        if (!text) throw new Error("답을 받지 못했어요. 다시 한 번 눌러주세요.");
        return json ? parseJsonSafe(text) : text;
      } catch (e) {
        throw e;
      }
    }
  }
  throw lastErr || new Error("지금은 연결이 어려워요. 1~2분 뒤에 다시 해주세요.");
}

// 모델이 ```json 코드블록이나 설명 문장으로 감싸거나(특히 Gemma) 여러 덩어리를
// 뱉는 경우까지 대비해, 텍스트 안의 '균형 잡힌' JSON 객체들을 찾아 파싱을 시도한다.
function parseJsonSafe(text) {
  const stripped = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(stripped); } catch (_) { /* 아래에서 재시도 */ }

  // 중괄호 짝을 세어 완결된 { ... } 후보들을 모은다
  const candidates = [];
  let depth = 0, startIdx = -1, inStr = false, esc = false;
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") { if (depth === 0) startIdx = i; depth++; }
    else if (c === "}") { depth--; if (depth === 0 && startIdx !== -1) { candidates.push(stripped.slice(startIdx, i + 1)); startIdx = -1; } }
  }
  // 내용이 가장 많은(=실제 답에 가까운) 후보부터 파싱 시도. 빈 템플릿은 뒤로.
  candidates.sort((a, b) => b.length - a.length);
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (obj && typeof obj === "object" && Object.keys(obj).length) return obj;
    } catch (_) { /* 다음 후보 */ }
  }
  throw new Error("답을 정리하다 문제가 생겼어요. 한 번만 다시 눌러주세요.");
}

// ---------- 음성 (TTS / STT) ----------
// 크롬(안드로이드)은 한 번에 긴 문장을 읽으면 15초쯤에서 뚝 끊긴다.
// 문장 단위로 잘라 이어 읽게 해서 해결. 읽는 중에 다시 누르면 멈춘다.
function speak(text) {
  // 버튼용: 읽는 중에 다시 누르면 멈춘다 (토글)
  const synth = window.speechSynthesis;
  if (!synth) { toast("이 브라우저는 소리 읽기를 지원하지 않아요"); return; }
  if (synth.speaking || synth.pending) { synth.cancel(); toast("읽기를 멈췄어요"); return; }
  queueSpeech(text);
}

function speakNow(text) {
  // 자동 안내용: 이전 음성을 끊고 즉시 새 안내를 읽는다 (연습 단계, 안내창 등)
  const synth = window.speechSynthesis;
  if (!synth) return;
  synth.cancel();
  queueSpeech(text);
}

function queueSpeech(text) {
  const synth = window.speechSynthesis;
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
  doc:      { icon: "#i-doc",    cls: "blue",   label: "서류 해석" },
  phone:    { icon: "#i-phone",  cls: "green",  label: "폰 사용법" },
  scam:     { icon: "#i-shield", cls: "red",    label: "사기 검사" },
  practice: { icon: "#i-play",   cls: "orange", label: "연습" },
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
  } else if (entry.type === "practice") {
    // 저장된 AI 연습 계획을 API 호출 없이 다시 실행한다
    goScreen("practice");
    window.runPracticePlan(entry.data);
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

let docImagesBase64 = []; // 여러 장짜리 서류 지원 (추가 질문에도 함께 보낸다)

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

async function analyzeDoc(files) {
  if (!requireKey()) return;
  try {
    if (files.length > 3) toast("사진은 3장까지만 볼 수 있어요. 앞의 3장을 사용할게요.");
    const picked = files.slice(0, 3);

    $("doc-start").classList.add("hidden");
    $("doc-result").classList.add("hidden");
    $("doc-loading").classList.remove("hidden");
    startLoadingMsgs("doc-loading", [
      "서류를 꼼꼼히 읽고 있어요...",
      "어려운 말을 쉬운 말로 바꾸고 있어요...",
      "조심할 부분이 있는지 찾고 있어요...",
      "거의 다 됐어요, 잠시만요...",
    ]);

    const imgs = [];
    for (const f of picked) imgs.push(await fileToResizedBase64(f));
    docImagesBase64 = imgs.map((i) => i.base64);

    const prompt = imgs.length > 1
      ? `${DOC_PROMPT}\n\n(사진 ${imgs.length}장은 같은 서류의 여러 페이지입니다. 전체를 하나의 서류로 보고 정리하세요.)`
      : DOC_PROMPT;

    const result = await callGemini([
      { text: prompt },
      ...imgs.map((i) => ({ inlineData: { mimeType: "image/jpeg", data: i.base64 } })),
    ]);

    renderDocResult(result, imgs[0].dataUrl);

    const thumb = await shrinkDataUrl(imgs[0].dataUrl);
    saveHistoryEntry({ type: "doc", ts: Date.now(), title: result.doc_type, data: result, img: thumb });
  } catch (e) {
    $("doc-loading").classList.add("hidden");
    $("doc-start").classList.remove("hidden");
    toast(e.message);
  } finally {
    stopLoadingMsgs();
  }
}

$("doc-camera").addEventListener("change", (e) => e.target.files[0] && analyzeDoc([...e.target.files]));
$("doc-file").addEventListener("change", (e) => e.target.files[0] && analyzeDoc([...e.target.files]));
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
  if (!docImagesBase64.length) {
    // 기록에서 열었을 때는 화면의 썸네일로 다시 질문한다
    const src = $("doc-preview").src;
    if (src.startsWith("data:")) docImagesBase64 = [src.split(",")[1]];
    else { toast("사진이 없어서 질문할 수 없어요. 서류를 다시 찍어주세요."); return; }
  }
  try {
    $("doc-ask").textContent = "생각하는 중...";
    const answer = await callGemini([
      { text: `사진 속 문서를 보고 어르신의 질문에 다정하고 아주 쉬운 한국어 2~3문장으로 답하세요. 질문: ${q}` },
      ...docImagesBase64.map((b) => ({ inlineData: { mimeType: "image/jpeg", data: b } })),
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

let currentPhoneSteps = [];

function renderPhoneResult(data, shotImg) {
  $("phone-loading").classList.add("hidden");
  $("phone-result").classList.remove("hidden");

  currentPhoneSteps = data.steps || [];
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
    startLoadingMsgs("phone-loading", [
      "화면을 살펴보고 있어요...",
      "어디를 눌러야 할지 찾고 있어요...",
      "쉬운 순서로 정리하고 있어요...",
      "거의 다 됐어요, 잠시만요...",
    ]);

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
  } finally {
    stopLoadingMsgs();
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

// ---------- 화면 위 떠 있는 안내창 (PiP 오버레이) ----------
// 안내 단계를 그린 캔버스를 영상으로 바꿔 PiP(작은 창)로 띄운다.
// PiP 창은 다른 앱 위에도 떠 있으므로, 설정·카카오톡을 쓰는 동안 안내가 따라다닌다.
// 창의 이전(⏮)/다음(⏭) 버튼으로 단계를 넘긴다.
const FLOAT_W = 640, FLOAT_H = 360;
let floatSteps = [];
let floatIdx = 0;
let floatCanvas = null;
let floatVideo = null;
let floatTimer = null;

function wrapCanvasText(ctx, text, maxWidth) {
  const chars = text.split("");
  const lines = [];
  let line = "";
  for (const ch of chars) {
    if (ctx.measureText(line + ch).width > maxWidth && line) { lines.push(line); line = ch; }
    else line += ch;
  }
  if (line) lines.push(line);
  return lines;
}

function drawFloatStep() {
  const ctx = floatCanvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, FLOAT_W, FLOAT_H);

  // 상단 띠
  ctx.fillStyle = "#3182f6";
  ctx.fillRect(0, 0, FLOAT_W, 64);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 30px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("AI 손주 따라하기", 24, 43);
  ctx.textAlign = "right";
  ctx.fillText(`${floatIdx + 1} / ${floatSteps.length}`, FLOAT_W - 24, 43);

  // 단계 내용 (자동 줄바꿈)
  ctx.fillStyle = "#191f28";
  ctx.font = "bold 40px sans-serif";
  ctx.textAlign = "left";
  const lines = wrapCanvasText(ctx, floatSteps[floatIdx] || "", FLOAT_W - 60);
  const lineH = 54;
  let y = 130;
  lines.slice(0, 4).forEach((l) => { ctx.fillText(l, 30, y); y += lineH; });

  // 하단 안내
  ctx.fillStyle = "#8b95a1";
  ctx.font = "26px sans-serif";
  ctx.fillText("창의 ⏮ ⏭ 버튼으로 단계를 넘기세요", 30, FLOAT_H - 26);
}

function setFloatIdx(idx) {
  floatIdx = Math.min(Math.max(idx, 0), floatSteps.length - 1);
  drawFloatStep();
  speakNow(floatSteps[floatIdx]);
}

async function startFloatingGuide(steps) {
  if (!steps || !steps.length) { toast("안내할 단계가 없어요"); return; }
  if (!document.pictureInPictureEnabled) {
    toast("이 브라우저는 화면 위 안내창을 지원하지 않아요. 크롬으로 열어보세요.");
    return;
  }
  try {
    floatSteps = steps;
    floatIdx = 0;
    if (!floatCanvas) {
      floatCanvas = document.createElement("canvas");
      floatCanvas.width = FLOAT_W;
      floatCanvas.height = FLOAT_H;
    }
    drawFloatStep();

    if (!floatVideo) {
      floatVideo = document.createElement("video");
      floatVideo.muted = true;
      floatVideo.playsInline = true;
      // display:none이면 PiP가 안 되므로 화면 밖에 숨겨둔다
      floatVideo.style.cssText = "position:fixed;right:-9999px;bottom:0;width:1px;height:1px;";
      document.body.appendChild(floatVideo);
      floatVideo.addEventListener("leavepictureinpicture", stopFloatingGuide);
    }
    floatVideo.srcObject = floatCanvas.captureStream(2);
    await floatVideo.play();
    await floatVideo.requestPictureInPicture();

    // 일부 기기에서 정지 화면이 멈춰 보이지 않도록 주기적으로 다시 그린다
    clearInterval(floatTimer);
    floatTimer = setInterval(drawFloatStep, 1000);

    // PiP 창의 이전/다음 버튼으로 단계 이동
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: "AI 손주 따라하기" });
      navigator.mediaSession.setActionHandler("previoustrack", () => setFloatIdx(floatIdx - 1));
      navigator.mediaSession.setActionHandler("nexttrack", () => setFloatIdx(floatIdx + 1));
    }
    speakNow(`안내창을 띄웠어요. 이제 홈으로 나가서 따라해 보세요. 1번. ${floatSteps[0]}`);
    toast("안내창이 떴어요! 홈 버튼을 눌러 나가도 계속 보여요.");
  } catch (e) {
    toast("화면 위 안내창을 띄우지 못했어요. 크롬 최신 버전에서 다시 해보세요.");
  }
}

function stopFloatingGuide() {
  clearInterval(floatTimer);
  floatTimer = null;
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
    } catch (_) { /* 미지원 무시 */ }
  }
  if (floatVideo) floatVideo.pause();
}

$("phone-float").addEventListener("click", () => startFloatingGuide(currentPhoneSteps));

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
    startLoadingMsgs("scam-loading", [
      "사기 수법인지 꼼꼼히 살펴보고 있어요...",
      "잘 알려진 사기 수법과 비교하고 있어요...",
      "거의 다 됐어요, 잠시만요...",
    ]);

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
  } finally {
    stopLoadingMsgs();
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

// ---------- 시간대별 인사말 ----------
(function setGreeting() {
  const h = new Date().getHours();
  let hello;
  if (h >= 5 && h < 11) hello = "좋은 아침이에요!";
  else if (h >= 11 && h < 17) hello = "안녕하세요!";
  else if (h >= 17 && h < 21) hello = "편안한 저녁이에요!";
  else hello = "늦은 시간이네요!";
  document.querySelector(".greeting").innerHTML = `${hello}<br>무엇을 도와드릴까요?`;
})();

// ---------- 오늘의 폰 꿀팁 (AI가 매일 하나씩) ----------
const TIP_STORAGE = "ai_sonju_daily_tip";

async function loadDailyTip(force = false) {
  if (!getKey()) return; // 키 없으면 조용히 건너뛴다
  const today = new Date().toDateString();
  try {
    const cached = JSON.parse(localStorage.getItem(TIP_STORAGE) || "null");
    if (!force && cached && cached.day === today && cached.text) {
      showTip(cached.text);
      return;
    }
  } catch (_) { /* 캐시가 깨졌으면 새로 받는다 */ }

  try {
    const tip = await callGemini([{ text:
      "당신은 어르신을 돕는 다정한 손주 AI입니다. 할머니 할아버지께 도움되는 스마트폰 사용 꿀팁을 딱 하나만, " +
      "2~3문장의 아주 쉬운 한국어로 알려주세요. 인사말이나 설명 없이 꿀팁 내용만 답하세요." +
      (force ? " 흔한 꿀팁 말고 조금 색다른 것으로요." : "")
    }], { json: false });
    localStorage.setItem(TIP_STORAGE, JSON.stringify({ day: today, text: tip.trim() }));
    showTip(tip.trim());
  } catch (_) { /* 홈 화면이므로 오류를 떠들지 않는다 */ }
}

function showTip(text) {
  $("tip-text").textContent = text;
  $("tip-card").classList.remove("hidden");
  $("tip-tts").onclick = () => speak(text);
}

$("tip-refresh").addEventListener("click", () => {
  $("tip-text").textContent = "새 꿀팁을 가져오고 있어요...";
  loadDailyTip(true);
});

loadDailyTip();

// ---------- 오프라인 지원 (서비스 워커) ----------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* 미지원/실패해도 앱은 정상 동작 */ });
}

// ---------- 첫 실행 안내 ----------
// 프록시가 없고 키도 없을 때만 설정을 연다 (프록시 배포본은 어르신이 아무것도 안 함)
if (!window.AI_SONJU_PROXY_URL && !getKey()) {
  setTimeout(openSettings, 600);
}
