// 실행: npm test   (apple 폴더에서)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RULES, createSeededRng, createIdGen, normalizeSelection, evaluateSelection, calculateScore,
  applyRemoval, findAnyValidRectangle, createStartBoard, generateValidBoard, tryRecoverBoard,
  getDueBonusEvents, promoteBonus, liveCells, countLiveBonus, formatRemainingTime,
} from "../rules.js";
import { createSession } from "../session.js";

const R = RULES.rows, C = RULES.cols;
let idSeq = 1000;
const a = (value, isBonus = false) => ({ id: idSeq++, value, isBonus });
const emptyBoard = () => Array.from({ length: R }, () => new Array(C).fill(null));
const fullBoard = (v) => Array.from({ length: R }, () => Array.from({ length: C }, () => a(v)));
const sel = (r0, c0, r1, c1) => normalizeSelection({ row: r0, col: c0 }, { row: r1, col: c1 });

// 유효 조합이 하나도 없는 보드: 생존 사과 1개뿐 (N>=2 불가)
const singleApple = () => { const b = emptyBoard(); b[0][0] = a(5); return b; };

test("1. 초기 보드는 10×17, 170칸 모두 1~9", () => {
  const b = createStartBoard(createSeededRng(1), createIdGen());
  assert.equal(b.length, 10);
  b.forEach((row) => assert.equal(row.length, 17));
  const live = liveCells(b);
  assert.equal(live.length, 170);
  live.forEach(({ cell }) => assert.ok(Number.isInteger(cell.value) && cell.value >= 1 && cell.value <= 9));
  assert.equal(new Set(live.map((x) => x.cell.id)).size, 170, "id 중복 없음");
  assert.equal(countLiveBonus(b), 2);
});

test("2. 드래그 방향 네 가지 모두 같은 직사각형", () => {
  const expected = { r0: 2, r1: 5, c0: 3, c1: 9 };
  assert.deepEqual(sel(2, 3, 5, 9), expected);
  assert.deepEqual(sel(5, 9, 2, 3), expected);
  assert.deepEqual(sel(2, 9, 5, 3), expected);
  assert.deepEqual(sel(5, 3, 2, 9), expected);
  assert.deepEqual(sel(-4, -1, 99, 99), { r0: 0, r1: 9, c0: 0, c1: 16 }, "보드 밖 좌표는 가장자리로");
});

test("3. 합계 10/20/30/100 유효, 0/9/11/25·N<2 무효", () => {
  const row = (vals) => { const b = emptyBoard(); vals.forEach((v, i) => { b[0][i] = a(v); }); return b; };
  const ev = (vals) => evaluateSelection(row(vals), sel(0, 0, 0, 16));
  assert.ok(ev([4, 6]).valid);
  assert.ok(ev([9, 9, 2]).valid);
  assert.ok(ev([9, 9, 9, 3]).valid);
  assert.ok(ev(new Array(12).fill(8).concat([4])).valid, "100");
  assert.equal(ev([]).valid, false, "0");
  assert.equal(ev([9]).valid, false, "9, N=1");
  assert.equal(ev([5, 6]).valid, false, "11");
  assert.equal(ev([9, 9, 7]).valid, false, "25");
  const one = emptyBoard(); one[0][0] = { id: 1, value: 10, isBonus: false };
  assert.equal(evaluateSelection(one, sel(0, 0, 0, 0)).valid, false, "비정상 값 10 단독");
  const bad = row([4, 6]); bad[0][2] = { id: 9, value: 0, isBonus: false };
  assert.equal(evaluateSelection(bad, sel(0, 0, 0, 2)).valid, false, "비정상 값 섞이면 무효");
});

test("4. 점수 벡터", () => {
  assert.equal(calculateScore({ N: 2, S: 10, B: 0 }), 2);
  assert.equal(calculateScore({ N: 4, S: 10, B: 0 }), 6);
  assert.equal(calculateScore({ N: 4, S: 20, B: 0 }), 8);
  assert.equal(calculateScore({ N: 6, S: 30, B: 1 }), 24);
  assert.equal(calculateScore({ N: 20, S: 100, B: 0 }), 40);
  assert.equal(calculateScore({ N: 0, S: 0, B: 0 }), 0);
  assert.equal(calculateScore({ N: 2, S: 11, B: 0 }), 0);
  assert.equal(calculateScore({ N: 2.5, S: 10, B: 0 }), 0);
});

test("5. 빈칸을 가로지르면 생존 사과만 합산, 중복 제거·가산 없음", () => {
  const b = emptyBoard();
  b[0][0] = a(3); b[0][5] = a(7); b[3][2] = a(5); b[3][3] = a(5);
  const s1 = sel(0, 0, 3, 5);
  const ev = evaluateSelection(b, s1);
  assert.deepEqual([ev.N, ev.S, ev.valid], [4, 20, true]);
  const after = applyRemoval(b, s1);
  assert.equal(liveCells(after).length, 0);
  const again = evaluateSelection(after, s1);
  assert.deepEqual([again.N, again.S, again.valid, again.earned], [0, 0, false, 0], "이미 제거한 칸 재득점 불가");
});

test("6. 보너스 1·2개 동시 제거 시 +10·+20", () => {
  const b = emptyBoard();
  b[0][0] = a(4, true); b[0][1] = a(6);
  assert.equal(evaluateSelection(b, sel(0, 0, 0, 1)).earned, 2 + 10);
  b[0][1] = a(6, true);
  assert.equal(evaluateSelection(b, sel(0, 0, 0, 1)).earned, 2 + 20);
});

test("7. 최초 보너스 2개는 1회, 20~100초 이벤트는 각 1회, 동시 최대 3개", () => {
  const s = createSession({ seed: 7 });
  s.start(0);
  assert.equal(countLiveBonus(s.board), 2);
  s.tick(20_000); s.tick(20_000); s.tick(39_999);
  assert.deepEqual([...s.processedEventIds], [20]);
  assert.equal(countLiveBonus(s.board), 3);
  s.tick(100_000);                                  // 숨김 탭 복귀처럼 한꺼번에 도래
  assert.deepEqual([...s.processedEventIds].sort((x, y) => x - y), [20, 40, 60, 80, 100]);
  assert.equal(countLiveBonus(s.board), 3, "상한 3개, 소멸한 시도는 누적되지 않음");
  assert.deepEqual(getDueBonusEvents(119_000, s.processedEventIds), []);

  const empty = emptyBoard();
  assert.equal(promoteBonus(empty, createSeededRng(1)).promoted, null, "승격할 일반 사과가 없으면 소멸");
  const b = emptyBoard(); b[2][3] = a(7);
  const p = promoteBonus(b, createSeededRng(1));
  assert.deepEqual(p.promoted, { r: 2, c: 3 });
  assert.deepEqual([p.board[2][3].value, p.board[2][3].isBonus, p.board[2][3].id], [7, true, b[2][3].id], "값·위치·id 유지");
});

test("8. 8,415개 직사각형을 검사하고 실제 사과 수 조건도 본다", () => {
  let visits = 0;
  assert.equal(findAnyValidRectangle(singleApple(), () => visits++), null);
  assert.equal(visits, 8415);
  const b = emptyBoard(); b[4][4] = a(9); b[4][5] = a(1);
  const found = findAnyValidRectangle(b);
  assert.ok(found && evaluateSelection(b, found).valid, "찾은 직사각형은 실제로 유효");
  const tenOnly = emptyBoard(); tenOnly[0][0] = { id: 1, value: 10, isBonus: false };
  assert.equal(findAnyValidRectangle(tenOnly), null, "합계 10이어도 사과 1개면 무효");
});

test("9. 해결 가능 보드는 복구 안 함, 불가능 보드는 제한 안에 해 1개 이상", () => {
  const ok = fullBoard(5);
  const r1 = tryRecoverBoard(ok, createSeededRng(1), createIdGen());
  assert.equal(r1.action, "none");
  assert.equal(r1.board, ok);

  const b = emptyBoard(); b[0][0] = a(9); b[9][16] = a(9);   // 9+9=18, 섞어도 불가, 인접 빈칸 있음
  const r2 = tryRecoverBoard(b, createSeededRng(2), createIdGen(5000));
  assert.equal(r2.action, "filled-4-6");
  assert.ok(r2.shuffles <= RULES.maxShuffles);
  assert.ok(findAnyValidRectangle(r2.board));
  assert.equal(liveCells(r2.board).length, 4);
});

test("10. 인접 빈칸이 없으면 4+6 보충 없이 전체 재생성", () => {
  // 17×10에서 "빈칸 비인접 + 유효 조합 없음"은 만들기 어려워 2×3 소형 보드로 확인 (규칙 함수는 크기 무관)
  const small = { ...RULES, rows: 2, cols: 3 };
  const tiny = [[a(9), null, a(9)], [null, a(9), null]];   // 빈칸 (0,1),(1,0),(1,2): 서로 인접 아님
  assert.equal(findAnyValidRectangle(tiny), null);          // 9+9=18, 9+9+9=27
  const r = tryRecoverBoard(tiny, createSeededRng(3), createIdGen(9000), small);
  assert.equal(r.action, "regenerated");
  assert.ok(findAnyValidRectangle(r.board));
  assert.equal(liveCells(r.board).length, 6, "새 보드는 꽉 참");
});

test("11. 보드가 완전히 비면 재생성, 점수·남은 시간·보너스 이력 유지", () => {
  const s = createSession({ seed: 11 });
  s.start(0);
  s.tick(20_000);
  const b = emptyBoard(); b[0][0] = a(4, true); b[0][1] = a(6);
  s.board = b;
  s.score = 50;
  const before = { startedAt: s.startedAt, idx: s.boardIndex, events: [...s.processedEventIds] };
  const res = s.submit(sel(0, 0, 0, 1), 30_000);
  assert.ok(res.accepted);
  assert.equal(res.recovery.action, "regenerated-empty");
  assert.equal(s.score, 50 + 12);
  assert.equal(s.startedAt, before.startedAt);
  assert.equal(s.remaining(30_000), 90_000);
  assert.deepEqual([...s.processedEventIds], before.events);
  assert.equal(s.boardIndex, before.idx + 1);
  assert.equal(countLiveBonus(s.board), 0, "최초 보너스 2개를 재지급하지 않음");
  assert.equal(liveCells(s.board).length, 170);
});

test("12. 섞기·재생성 시 보너스 수·상태 보존, 제거된 보너스는 부활 안 함", () => {
  // 섞기: 살아 있는 보너스 2개 유지
  const b = emptyBoard();
  b[0][0] = a(9, true); b[9][16] = a(9, true); b[5][8] = a(9);
  const ids = new Set([b[0][0].id, b[9][16].id]);
  const r = tryRecoverBoard(b, createSeededRng(4), createIdGen(7000));
  const bonuses = liveCells(r.board).filter((x) => x.cell.isBonus);
  assert.equal(bonuses.length, 2);
  bonuses.forEach((x) => { assert.ok(ids.has(x.cell.id)); assert.equal(x.cell.value, 9); });

  // 재생성: 살아남은 보너스만 이식
  const tiny = [[a(9, true), null, a(9)], [null, a(9), null]];
  const small = { ...RULES, rows: 2, cols: 3 };
  const g = tryRecoverBoard(tiny, createSeededRng(5), createIdGen(8000), small);
  assert.equal(g.action, "regenerated");
  const gb = liveCells(g.board).filter((x) => x.cell.isBonus);
  assert.equal(gb.length, 1);
  assert.equal(gb[0].cell.id, tiny[0][0].id);

  // 직접 생성: 이식 대상이 없으면 보너스 0개
  const fresh = generateValidBoard(createSeededRng(6), createIdGen(), []);
  assert.equal(countLiveBonus(fresh), 0);
});

test("시간: 119.9~120.1초 경계, 만료 후 제출 차단, 같은 시드는 같은 보드", () => {
  const s = createSession({ seed: 99 });
  s.start(1000);
  s.tick(1000 + 119_900);
  assert.equal(s.status, "PLAYING");
  assert.equal(formatRemainingTime(s.remaining(1000 + 119_900)), "0:01");
  const late = s.submit(sel(0, 0, 9, 16), 1000 + 120_100);
  assert.deepEqual([late.accepted, late.reason], [false, "time-up"]);
  assert.equal(s.status, "FINISHED");
  assert.equal(s.submit(sel(0, 0, 0, 1), 1000 + 130_000).reason, "not-playing");

  const x = createSession({ seed: 42 }); x.start(0);
  const y = createSession({ seed: 42 }); y.start(0);
  assert.deepEqual(x.board, y.board);
});

test("복구 단계 결정성: 고정 시드면 같은 결과", () => {
  const mk = () => { const b = emptyBoard(); b[0][0] = a(9); b[9][16] = a(9); return b; };
  idSeq = 1; const r1 = tryRecoverBoard(mk(), createSeededRng(123), createIdGen(1));
  idSeq = 1; const r2 = tryRecoverBoard(mk(), createSeededRng(123), createIdGen(1));
  assert.deepEqual(r1, r2);
});

test("무작위 대량 시뮬레이션: 복구가 항상 끝나고 유효 보드를 남긴다", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const s = createSession({ seed });
    s.start(0);
    let t = 0;
    for (let k = 0; k < 400 && s.status === "PLAYING"; k++) {
      const rect = findAnyValidRectangle(s.board);
      assert.ok(rect, `seed ${seed}: 플레이 중 보드에는 유효 조합이 있어야 함`);
      t += 250;
      const res = s.submit(rect, t);
      if (!res.accepted) break;
      assert.ok(res.eval.earned >= 2);
    }
  }
});
