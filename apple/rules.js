// Apple × 10 — 게임 규칙 (DOM 없는 순수 함수). 브라우저와 Node 테스트가 함께 쓴다.
// 보드: board[row][col] = null | { id, value, isBonus }

export const RULES = {
  version: 1,
  rows: 10,
  cols: 17,
  durationMs: 120_000,
  startBonusCount: 2,               // [초기 권장값] 세션 최초 1회
  bonusEventSeconds: [20, 40, 60, 80, 100],
  maxLiveBonus: 3,
  bonusPoints: 10,
  countBonusCap: 8,
  sumBonusPerTen: 2,
  sumBonusCap: 6,
  maxShuffles: 10,                  // 복구 3단계
  maxRegenerations: 20,             // 복구 5단계 (사실상 1회면 성공)
};

// ---------- 난수 (고정 시드 재현용) ----------
export function createSeededRng(seed) {
  let a = seed >>> 0;               // mulberry32
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

export function createIdGen(start = 1) {
  let next = start;
  return () => next++;
}

// ---------- 선택 판정 ----------
export function normalizeSelection(a, b, rules = RULES) {
  const clampR = (r) => Math.min(Math.max(r, 0), rules.rows - 1);
  const clampC = (c) => Math.min(Math.max(c, 0), rules.cols - 1);
  return {
    r0: clampR(Math.min(a.row, b.row)), r1: clampR(Math.max(a.row, b.row)),
    c0: clampC(Math.min(a.col, b.col)), c1: clampC(Math.max(a.col, b.col)),
  };
}

const isValidApple = (cell) =>
  cell !== null && typeof cell === "object" &&
  Number.isInteger(cell.value) && cell.value >= 1 && cell.value <= 9;

export function isValidTotal(N, S) {
  return N >= 2 && S >= 10 && S % 10 === 0;
}

export function calculateScore({ N, S, B }, rules = RULES) {
  if (!Number.isInteger(N) || !Number.isInteger(S) || !Number.isInteger(B)) return 0;
  if (!isValidTotal(N, S) || B < 0 || B > N) return 0;
  const countBonus = Math.min(Math.max(N - 2, 0), rules.countBonusCap);
  const sumBonus = rules.sumBonusPerTen * Math.min(S / 10 - 1, rules.sumBonusCap);
  return N + countBonus + sumBonus + rules.bonusPoints * B;
}

export function evaluateSelection(board, sel, rules = RULES) {
  let N = 0, S = 0, B = 0, corrupt = false;
  for (let r = sel.r0; r <= sel.r1; r++) {
    for (let c = sel.c0; c <= sel.c1; c++) {
      const cell = board[r][c];
      if (cell === null) continue;
      if (!isValidApple(cell)) { corrupt = true; continue; }
      N++; S += cell.value; if (cell.isBonus) B++;
    }
  }
  const valid = !corrupt && isValidTotal(N, S);
  return { N, S, B, valid, earned: valid ? calculateScore({ N, S, B }, rules) : 0 };
}

export function applyRemoval(board, sel) {
  const next = board.map((row) => row.slice());
  for (let r = sel.r0; r <= sel.r1; r++)
    for (let c = sel.c0; c <= sel.c1; c++) next[r][c] = null;
  return next;
}

// ---------- 유효 직사각형 검사 (2차원 누적합) ----------
export function getPrefixSums(board) {
  const R = board.length, C = board[0].length;
  const sum = Array.from({ length: R + 1 }, () => new Array(C + 1).fill(0));
  const cnt = Array.from({ length: R + 1 }, () => new Array(C + 1).fill(0));
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const cell = board[r][c];
      const v = isValidApple(cell) ? cell.value : 0;
      const n = isValidApple(cell) ? 1 : 0;
      sum[r + 1][c + 1] = v + sum[r][c + 1] + sum[r + 1][c] - sum[r][c];
      cnt[r + 1][c + 1] = n + cnt[r][c + 1] + cnt[r + 1][c] - cnt[r][c];
    }
  }
  return { sum, cnt };
}

// 모든 직사각형(10행 구간 55 × 17열 구간 153 = 8,415개)을 차례로 본다.
// onVisit은 테스트에서 검사 개수를 세는 용도.
export function findAnyValidRectangle(board, onVisit) {
  const R = board.length, C = board[0].length;
  const { sum, cnt } = getPrefixSums(board);
  const area = (t, r0, c0, r1, c1) => t[r1 + 1][c1 + 1] - t[r0][c1 + 1] - t[r1 + 1][c0] + t[r0][c0];
  for (let r0 = 0; r0 < R; r0++)
    for (let r1 = r0; r1 < R; r1++)
      for (let c0 = 0; c0 < C; c0++)
        for (let c1 = c0; c1 < C; c1++) {
          if (onVisit) onVisit();
          if (isValidTotal(area(cnt, r0, c0, r1, c1), area(sum, r0, c0, r1, c1)))
            return { r0, r1, c0, c1 };
        }
  return null;
}

// ---------- 보드 생성 ----------
const apple = (id, value, isBonus = false) => ({ id, value, isBonus });

export function generateRandomBoard(rng, nextId, rules = RULES) {
  return Array.from({ length: rules.rows }, () =>
    Array.from({ length: rules.cols }, () => apple(nextId(), randInt(rng, 1, 9))));
}

export function liveCells(board) {
  const out = [];
  board.forEach((row, r) => row.forEach((cell, c) => { if (cell) out.push({ r, c, cell }); }));
  return out;
}

export const countLiveBonus = (board) => liveCells(board).filter((x) => x.cell.isBonus).length;

// 새 보드: 인접한 일반 사과 두 칸을 4, 6으로 보장하고, 살아남은 보너스 객체를 다른 칸에 이식.
export function generateValidBoard(rng, nextId, carryBonuses = [], rules = RULES) {
  const board = generateRandomBoard(rng, nextId, rules);
  const horizontal = rng() < 0.5;
  const r = randInt(rng, 0, rules.rows - (horizontal ? 1 : 2));
  const c = randInt(rng, 0, rules.cols - (horizontal ? 2 : 1));
  const r2 = horizontal ? r : r + 1, c2 = horizontal ? c + 1 : c;
  board[r][c] = apple(nextId(), 4);
  board[r2][c2] = apple(nextId(), 6);

  const reserved = new Set([`${r},${c}`, `${r2},${c2}`]);
  const free = [];
  for (let i = 0; i < rules.rows; i++)
    for (let j = 0; j < rules.cols; j++)
      if (!reserved.has(`${i},${j}`)) free.push([i, j]);
  shuffleInPlace(free, rng);
  carryBonuses.slice(0, rules.maxLiveBonus).forEach((b, k) => {
    const [i, j] = free[k];
    board[i][j] = { ...b };
  });
  return board;
}

// 게임 시작 보드: 무작위 170칸 + 보너스 2개. 유효 조합이 없으면 4·6 보장 보드로.
export function createStartBoard(rng, nextId, rules = RULES) {
  let board = generateRandomBoard(rng, nextId, rules);
  if (!findAnyValidRectangle(board)) board = generateValidBoard(rng, nextId, [], rules);
  const cells = liveCells(board);
  shuffleInPlace(cells, rng);
  cells.slice(0, rules.startBonusCount).forEach(({ r, c, cell }) => {
    board[r][c] = { ...cell, isBonus: true };
  });
  return board;
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- 진행 불가 복구 ----------
// 반환: { board, action, shuffles, regenerations } 또는 { error }
// action: none | regenerated-empty | shuffled | filled-4-6 | regenerated
export function tryRecoverBoard(board, rng, nextId, rules = RULES) {
  if (findAnyValidRectangle(board)) return { board, action: "none", shuffles: 0, regenerations: 0 };

  const live = liveCells(board);
  if (live.length === 0) {
    return { board: generateValidBoard(rng, nextId, [], rules), action: "regenerated-empty", shuffles: 0, regenerations: 1 };
  }

  // 3단계: 살아 있는 사과 객체만 기존 점유 칸 안에서 섞기 (빈칸 유지)
  let current = board;
  for (let i = 1; i <= rules.maxShuffles; i++) {
    const objs = shuffleInPlace(live.map((x) => x.cell), rng);
    current = board.map((row) => row.slice());
    live.forEach(({ r, c }, k) => { current[r][c] = objs[k]; });
    if (findAnyValidRectangle(current)) return { board: current, action: "shuffled", shuffles: i, regenerations: 0 };
  }

  // 4단계: 가로·세로로 인접한 빈칸 2개가 있으면 4, 6 보충
  const pairs = [];
  for (let r = 0; r < rules.rows; r++)
    for (let c = 0; c < rules.cols; c++) {
      if (current[r][c] !== null) continue;
      if (c + 1 < rules.cols && current[r][c + 1] === null) pairs.push([r, c, r, c + 1]);
      if (r + 1 < rules.rows && current[r + 1][c] === null) pairs.push([r, c, r + 1, c]);
    }
  if (pairs.length > 0) {
    const [r, c, r2, c2] = pairs[Math.floor(rng() * pairs.length)];
    const filled = current.map((row) => row.slice());
    filled[r][c] = apple(nextId(), 4);
    filled[r2][c2] = apple(nextId(), 6);
    if (findAnyValidRectangle(filled))
      return { board: filled, action: "filled-4-6", shuffles: rules.maxShuffles, regenerations: 0 };
  }

  // 5단계: 전체 재생성 (살아남은 보너스만 이식, 반복 횟수 제한)
  const bonuses = live.filter((x) => x.cell.isBonus).map((x) => x.cell);
  for (let i = 1; i <= rules.maxRegenerations; i++) {
    const fresh = generateValidBoard(rng, nextId, bonuses, rules);
    if (findAnyValidRectangle(fresh))
      return { board: fresh, action: "regenerated", shuffles: rules.maxShuffles, regenerations: i };
  }
  return { error: "recovery-failed" };
}

// ---------- 보너스 이벤트 ----------
export function getDueBonusEvents(elapsedMs, processedIds, rules = RULES) {
  return rules.bonusEventSeconds
    .filter((s) => s * 1000 <= elapsedMs && s * 1000 < rules.durationMs && !processedIds.has(s));
}

// 일반 생존 사과 하나를 보너스로 승격 (값·위치 유지). 상한이거나 대상이 없으면 소멸.
export function promoteBonus(board, rng, rules = RULES) {
  if (countLiveBonus(board) >= rules.maxLiveBonus) return { board, promoted: null };
  const normals = liveCells(board).filter((x) => !x.cell.isBonus);
  if (normals.length === 0) return { board, promoted: null };
  const { r, c, cell } = normals[Math.floor(rng() * normals.length)];
  const next = board.map((row) => row.slice());
  next[r][c] = { ...cell, isBonus: true };
  return { board: next, promoted: { r, c } };
}

export function formatRemainingTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
