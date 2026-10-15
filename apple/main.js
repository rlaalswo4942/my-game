// 화면·입력 담당. 규칙은 rules.js, 로컬 세션은 session.js, 온라인은 online.js.
import { RULES, normalizeSelection, evaluateSelection, formatRemainingTime } from "./rules.js";
import { createSession } from "./session.js";
import { onlineConfigured, createRankedEngine, fetchLeaderboard } from "./online.js";

const $ = (id) => document.getElementById(id);
const boardEl = $("board"), selBox = $("selBox"), overlay = $("overlay");
const ROWS = RULES.rows, COLS = RULES.cols;

// ---------- 저장 (브라우저 저장소는 실패해도 게임은 돌아가야 함) ----------
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 무시 */ } },
};
const BEST_KEY = "appleX10.best.v" + RULES.version;
const HISTORY_KEY = "appleX10.history.v" + RULES.version;
const NICK_KEY = "appleX10.nickname";

// ---------- 엔진 (연습 / 랭킹 공통 모양) ----------
function createLocalEngine() {
  const s = createSession();
  const now = () => performance.now();          // 단조 시계: 숨긴 탭에서도 흐름
  return {
    mode: "local",
    get status() { return s.status; },
    get score() { return s.score; },
    get board() { return s.board; },
    get boardIndex() { return s.boardIndex; },
    get error() { return s.error; },
    remaining: () => s.remaining(now()),
    start: async () => { s.start(now()); },
    submit: async (sel) => s.submit(sel, now()),
    tick: () => s.tick(now()),
    finish: async () => ({ score: s.score }),
    isBusy: () => false,
  };
}

let engine = null;
let gameGen = 0;            // 재시작하면 증가 → 이전 게임의 늦은 이벤트·응답 무시
let finishedHandled = false;
let drag = null;            // { pointerId, start, end, gen }

// ---------- 게임판 ----------
const cells = [];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const cell = document.createElement("div");
    cell.className = "cell empty";
    cell.setAttribute("role", "gridcell");
    const ap = document.createElement("span");
    ap.className = "apple";
    cell.appendChild(ap);
    boardEl.appendChild(cell);
    cells.push(cell);
  }
}

function renderBoard() {
  const b = engine?.board;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = cells[r * COLS + c];
      const x = b ? b[r][c] : null;
      el.classList.toggle("empty", !x);
      el.classList.toggle("bonus", Boolean(x?.isBonus));
      el.firstChild.textContent = x ? x.value : "";
      el.setAttribute("aria-label", x ? `${x.value}${x.isBonus ? ", 보너스" : ""}` : "빈칸");
    }
  }
}

function renderStats() {
  $("score").textContent = engine ? engine.score : 0;
  const ms = engine ? engine.remaining() : RULES.durationMs;
  $("time").textContent = formatRemainingTime(ms);
  $("time").classList.toggle("low", engine?.status === "PLAYING" && ms <= 10_000);
  $("best").textContent = store.get(BEST_KEY, 0);
}

const setStatus = (msg) => { $("status").textContent = msg; };

// ---------- 입력 (Pointer Events) ----------
function cellFromPoint(x, y) {
  const rect = boardEl.getBoundingClientRect();          // 리사이즈·줌 후에도 매번 다시 잰다
  const col = Math.floor(((x - rect.left) / rect.width) * COLS);
  const row = Math.floor(((y - rect.top) / rect.height) * ROWS);
  return {                                               // 보드 밖으로 나가면 가장자리로 제한
    row: Math.min(Math.max(row, 0), ROWS - 1),
    col: Math.min(Math.max(col, 0), COLS - 1),
  };
}

const canDrag = () => engine && engine.status === "PLAYING" && !engine.isBusy();

function showSelection(sel) {
  if (!sel) { selBox.hidden = true; return; }
  const w = boardEl.offsetWidth / COLS, h = boardEl.offsetHeight / ROWS;
  Object.assign(selBox.style, {
    left: sel.c0 * w + "px", top: sel.r0 * h + "px",
    width: (sel.c1 - sel.c0 + 1) * w + "px", height: (sel.r1 - sel.r0 + 1) * h + "px",
  });
  selBox.hidden = false;
}

function updatePreview() {
  const p = $("preview");
  if (!drag) { showSelection(null); return; }
  const sel = normalizeSelection(drag.start, drag.end);
  const ev = evaluateSelection(engine.board, sel);
  showSelection(sel);
  selBox.classList.toggle("valid", ev.valid);
  // 미리보기는 점수를 확정하지 않는다
  p.innerHTML = "";
  p.append(`합계 ${ev.S} · 사과 ${ev.N}개${ev.B ? ` (★${ev.B})` : ""} · `);
  const tag = document.createElement("span");
  tag.className = ev.valid ? "valid" : "invalid";
  tag.textContent = ev.valid ? `제거 가능 · 예상 +${ev.earned}점` : "10의 배수가 아니거나 사과가 2개 미만";
  p.append(tag);
}

function endDrag() {
  drag = null;
  showSelection(null);
}

boardEl.addEventListener("pointerdown", (e) => {
  if (drag || !e.isPrimary) return;                          // 멀티터치의 두 번째 손가락 무시
  if (e.pointerType === "mouse" && e.button !== 0) return;   // 우클릭·휠 클릭 무시
  if (!canDrag()) return;
  e.preventDefault();
  boardEl.setPointerCapture(e.pointerId);
  const cell = cellFromPoint(e.clientX, e.clientY);
  drag = { pointerId: e.pointerId, start: cell, end: cell, gen: gameGen };
  updatePreview();
});

boardEl.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.end = cellFromPoint(e.clientX, e.clientY);
  updatePreview();
});

boardEl.addEventListener("pointerup", (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;      // 중복 pointerup은 drag가 없어서 무시됨
  drag.end = cellFromPoint(e.clientX, e.clientY);
  const d = drag;
  endDrag();
  if (d.gen !== gameGen) return;                             // 재시작 전에 시작된 드래그
  commit(normalizeSelection(d.start, d.end));
});

for (const type of ["pointercancel", "lostpointercapture"]) {
  boardEl.addEventListener(type, (e) => {
    if (drag && e.pointerId === drag.pointerId) { endDrag(); $("preview").textContent = "드래그가 취소됐어요"; }
  });
}
boardEl.addEventListener("contextmenu", (e) => e.preventDefault());

const RECOVERY_MSG = {
  "shuffled": "더 없앨 수 있는 묶음이 없어 남은 사과를 섞었어요",
  "filled-4-6": "묶음이 없어 빈자리에 4와 6을 채웠어요",
  "regenerated": "묶음이 없어 새 판을 깔았어요 (★ 보너스는 그대로)",
  "regenerated-empty": "판을 다 비웠어요! 새 판을 깔았어요",
};

async function commit(sel) {
  const gen = gameGen;
  const res = await engine.submit(sel);
  if (gen !== gameGen) return;
  if (res.accepted) {
    const ev = res.eval;
    setStatus(`+${ev.earned}점 (합계 ${ev.S}, 사과 ${ev.N}개${ev.B ? `, ★${ev.B}개 +${ev.B * RULES.bonusPoints}` : ""})`);
    const rec = res.recovery?.action;
    if (rec && rec !== "none") {
      setStatus(RECOVERY_MSG[rec] ?? "판을 복구했어요");
      boardEl.classList.remove("flash"); void boardEl.offsetWidth; boardEl.classList.add("flash");
    }
  } else if (res.reason === "invalid") {
    setStatus(`합계 ${res.eval.S} — 10의 배수이고 사과가 2개 이상이어야 해요`);
  } else if (res.reason === "time-up") {
    setStatus("시간이 끝나서 점수에 반영되지 않았어요");
  } else if (res.reason === "network") {
    setStatus("서버와 연결이 불안정해요. 판을 서버 상태로 다시 맞췄어요");
  } else if (res.reason === "busy") {
    setStatus("서버 확인 중이에요. 잠시 후 다시 드래그하세요");
  }
  if (engine.error === "recovery-failed") setStatus("판 복구에 실패했어요. 다시 시작을 눌러 주세요");
  $("preview").textContent = "드래그해서 사과를 묶어 보세요";
  renderBoard();
  renderStats();
}

// ---------- 시작 / 종료 ----------
async function startGame() {
  const mode = $("modeSel").value;
  let next;
  if (mode === "ranked") {
    if (!onlineConfigured) { setStatus("온라인 랭킹이 아직 연결되지 않았어요. 연습 모드로 플레이하세요"); return; }
    const nick = await askNickname();
    if (!nick) return;
    next = createRankedEngine();
    setStatus("서버에서 판을 받는 중…");
    try { await next.start(nick); }
    catch (err) { setStatus("서버에 연결하지 못했어요: " + (err.message ?? err)); return; }
  } else {
    next = createLocalEngine();
    await next.start();
  }
  gameGen++;
  endDrag();
  engine = next;
  finishedHandled = false;
  overlay.hidden = true;
  $("startBtn").textContent = "다시 시작";
  setStatus(mode === "ranked" ? "랭킹 게임 시작! 서버 시각 기준 120초" : "연습 게임 시작! 120초");
  renderBoard();
  renderStats();
}

async function handleFinished() {
  finishedHandled = true;
  const gen = gameGen;
  endDrag();
  overlay.textContent = "시간 종료";
  overlay.hidden = false;
  let score = engine.score, detail = "";
  if (engine.mode === "ranked") {
    try { score = (await engine.finish()).score; detail = "서버가 확정한 점수로 랭킹에 반영됐어요."; }
    catch { detail = "서버 확정에 실패했어요. 잠시 후 랭킹에서 확인하세요."; }
  } else {
    const best = Math.max(store.get(BEST_KEY, 0), score);
    store.set(BEST_KEY, best);
    const hist = store.get(HISTORY_KEY, []);
    hist.unshift({ score, at: new Date().toISOString() });
    store.set(HISTORY_KEY, hist.slice(0, 10));
    detail = `연습 최고 기록 ${best}점 · 사용한 판 ${engine.boardIndex}개 (온라인 랭킹 미반영)`;
  }
  if (gen !== gameGen) return;
  $("resScore").textContent = score;
  $("resDetail").textContent = detail;
  setStatus("시간 종료!");
  renderStats();
  $("resultDlg").showModal();
}

function loop() {
  if (engine && engine.status !== "READY") {
    if (engine.tick()) renderBoard();
    renderStats();
    if (engine.status === "FINISHED" && !finishedHandled) handleFinished();
  }
  requestAnimationFrame(loop);
}

// 숨긴 탭에서 돌아오면 즉시 시간·이벤트 반영
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && engine?.tick()) renderBoard();
});
window.addEventListener("resize", () => { if (drag) updatePreview(); });

// ---------- 닉네임 ----------
const NICK_RE = /^[가-힣A-Za-z0-9_-]{2,12}$/;

function askNickname() {
  return new Promise((resolve) => {
    const dlg = $("nickDlg"), input = $("nickInput"), err = $("nickErr");
    input.value = store.get(NICK_KEY, "");
    err.textContent = "";
    const onClose = () => {
      dlg.removeEventListener("close", onClose);
      if (dlg.returnValue !== "ok") return resolve(null);
      const nick = input.value.trim();
      if (!NICK_RE.test(nick)) {
        err.textContent = "2~12자 한글·영문·숫자·_·- 만 쓸 수 있어요";
        dlg.showModal();
        dlg.addEventListener("close", onClose);
        return;
      }
      store.set(NICK_KEY, nick);
      resolve(nick);
    };
    dlg.addEventListener("close", onClose);
    dlg.showModal();
  });
}

// ---------- 랭킹 ----------
async function loadRank(scope) {
  document.querySelectorAll(".tabs [role=tab]").forEach((t) =>
    t.setAttribute("aria-selected", String(t.dataset.scope === scope)));
  const tbody = $("rankTable").querySelector("tbody");
  const msg = $("rankMsg");
  tbody.replaceChildren();
  const addRow = (cols) => {
    const tr = document.createElement("tr");
    cols.forEach((v) => { const td = document.createElement("td"); td.textContent = v; tr.appendChild(td); });
    tbody.appendChild(tr);                              // textContent만 사용 → 닉네임 XSS 차단
  };
  const fmt = (iso) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });

  if (!onlineConfigured) {
    if (scope === "mine") {
      const hist = store.get(HISTORY_KEY, []);
      msg.textContent = hist.length ? "이 브라우저의 연습 기록 (온라인 랭킹 미반영)" : "아직 연습 기록이 없어요";
      hist.forEach((h, i) => addRow([i + 1, "나 (연습)", h.score, fmt(h.at)]));
    } else {
      msg.textContent = "온라인 랭킹이 아직 연결되지 않았어요 (apple/config.js 설정 필요)";
    }
    return;
  }
  msg.textContent = "불러오는 중…";
  try {
    const rows = await fetchLeaderboard(scope);
    msg.textContent = rows.length ? (scope === "daily" ? "오늘(한국 시간) 기록" : scope === "all" ? "전체 기록" : "내 최근 기록") : "아직 기록이 없어요";
    rows.forEach((r, i) => addRow([r.rank ?? i + 1, r.nickname, r.score, fmt(r.confirmed_at)]));
  } catch (err) {
    msg.textContent = "랭킹을 불러오지 못했어요: " + (err.message ?? err);
  }
}

// ---------- 버튼 ----------
if (!onlineConfigured) {
  const opt = $("modeSel").querySelector('[value="ranked"]');
  opt.disabled = true;
  opt.textContent = "랭킹 (온라인, 설정 필요)";
}
$("startBtn").addEventListener("click", startGame);
$("howBtn").addEventListener("click", () => $("howDlg").showModal());
$("rankBtn").addEventListener("click", () => { $("rankDlg").showModal(); loadRank("daily"); });
document.querySelectorAll(".tabs [role=tab]").forEach((t) => t.addEventListener("click", () => loadRank(t.dataset.scope)));
$("resultDlg").addEventListener("close", () => {
  const v = $("resultDlg").returnValue;
  if (v === "restart") startGame();
  if (v === "rank") { $("rankDlg").showModal(); loadRank(engine?.mode === "ranked" ? "daily" : "mine"); }
});

renderBoard();
renderStats();
setStatus("시작 버튼을 누르면 120초가 시작됩니다");
requestAnimationFrame(loop);

// 테스트용 훅 (자동화 테스트에서 상태 확인)
window.__apple = { get engine() { return engine; } };
