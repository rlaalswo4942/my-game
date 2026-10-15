// 서버 SQL 테스트: npm run sql   (PGlite = 브라우저/Node에서 도는 PostgreSQL. Supabase auth는 대역으로 흉내)
// 실제 Supabase의 동시 접속(행 잠금 경합)은 PGlite가 단일 연결이라 여기서 재현되지 않는다.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  createSeededRng, createIdGen, generateRandomBoard, findAnyValidRectangle, evaluateSelection, calculateScore,
} from "../rules.js";

const db = new PGlite();
const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const U3 = "33333333-3333-3333-3333-333333333333";

before(async () => {
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon; create role authenticated;
    grant usage on schema auth to anon, authenticated;
    insert into auth.users values ('${U1}'), ('${U2}'), ('${U3}');
  `);
  await db.exec(await readFile(new URL("../supabase/apple.sql", import.meta.url), "utf8"));
});

// 브라우저와 같은 권한(authenticated)으로 RPC 호출
async function call(uid, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role authenticated;`);
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec("reset role;"); }
}
const rpc = async (uid, fn, args) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await call(uid, `select public.${fn}(${ph}) as r`, args))[0].r;
};
const admin = (sql, params) => db.query(sql, params);
const toBoard = (flat) => Array.from({ length: 10 }, (_, r) => Array.from({ length: 17 }, (_, c) => {
  const x = flat[r * 17 + c]; return x ? { id: x.id, value: x.v, isBonus: x.b } : null;
}));
const flat = (board) => board.flat().map((x) => (x ? { id: x.id, v: x.value, b: x.isBonus } : null));
const ageRun = (id, secs) => admin(
  `update apple_private.runs set started_at = now() - make_interval(secs => $2::int),
     expires_at = now() - make_interval(secs => $2::int) + interval '120 seconds' where id = $1`, [id, secs]);
const allowNewRun = (uid) => admin(`update apple_private.runs set started_at = started_at - interval '10 seconds',
  expires_at = expires_at - interval '10 seconds' where user_id = $1`, [uid]);

test("공유 테스트 벡터: 점수 공식이 rules.js와 같다", async () => {
  const vecs = [[2, 10, 0, 2], [4, 10, 0, 6], [4, 20, 0, 8], [6, 30, 1, 24], [20, 100, 0, 40], [0, 0, 0, 0], [2, 11, 0, 0], [1, 10, 0, 0]];
  for (const [n, s, b, want] of vecs) {
    const got = (await admin("select apple_private.score($1, $2, $3) as v", [n, s, b])).rows[0].v;
    assert.equal(got, want, `(${n},${s},${b})`);
    assert.equal(calculateScore({ N: n, S: s, B: b }), want);
  }
});

test("공유 테스트 벡터: 유효 직사각형 존재 여부·선택 판정이 rules.js와 같다", async () => {
  const seen = { true: 0, false: 0 };
  for (let seed = 1; seed <= 24; seed++) {
    const rng = createSeededRng(seed);
    const board = generateRandomBoard(rng, createIdGen());
    const keep = seed <= 8 ? 0.03 : seed <= 16 ? 0.08 : 1;      // 듬성듬성한 판(해 없음)도 섞어서
    for (const row of board) for (let c = 0; c < 17; c++) if (rng() > keep) row[c] = null;
    const js = findAnyValidRectangle(board) !== null;
    const sql = (await admin("select apple_private.find_valid($1::jsonb) as v", [JSON.stringify(flat(board))])).rows[0].v;
    assert.equal(sql, js, `seed ${seed}`);
    seen[js]++;
    const sel = { r0: 1, c0: 2, r1: 7, c1: 12 };
    const e = evaluateSelection(board, sel);
    const row = (await admin("select * from apple_private.eval($1::jsonb, 1, 2, 7, 12)", [JSON.stringify(flat(board))])).rows[0];
    assert.deepEqual([row.n, row.s, row.b], [e.N, e.S, e.B]);
  }
  assert.ok(seen.true > 0 && seen.false > 0, "해 있는 판과 없는 판이 모두 포함");
});

test("start-run: 서버가 만든 17×10 보드, 보너스 2개, 120초", async () => {
  const st = await rpc(U1, "apple_start_run", ["사과왕"]);
  assert.equal(st.status, "playing");
  assert.equal(st.board.length, 170);
  assert.ok(st.board.every((x) => x && x.v >= 1 && x.v <= 9));
  assert.equal(st.board.filter((x) => x.b).length, 2);
  assert.equal(Date.parse(st.expires_at) - Date.parse(st.started_at), 120_000);
  assert.equal(st.next_seq, 1);
  await assert.rejects(rpc(U1, "apple_start_run", ["사과왕"]), /too many requests/, "5초 속도 제한");
});

test("submit-move: 서버 계산 점수, 중복 seq 1회만, 순서·범위 검증 (17)", async () => {
  await allowNewRun(U1);
  let st = await rpc(U1, "apple_start_run", ["사과왕"]);
  const board = toBoard(st.board);
  const rect = findAnyValidRectangle(board);
  const want = evaluateSelection(board, rect).earned;
  const args = [st.run_id, 1, rect.r1, rect.c1, rect.r0, rect.c0];        // 역방향 좌표
  st = await rpc(U1, "apple_submit_move", args);
  assert.equal(st.move.accepted, true);
  assert.equal(st.score, want);
  const again = await rpc(U1, "apple_submit_move", args);                 // 같은 seq 재전송
  assert.equal(again.move.reason, "duplicate");
  assert.equal(again.score, want, "점수 두 번 증가하지 않음");
  const moves = (await admin("select count(*)::int as n from apple_private.moves where run_id = $1", [st.run_id])).rows[0].n;
  assert.equal(moves, 1);
  await assert.rejects(rpc(U1, "apple_submit_move", [st.run_id, 5, 0, 0, 0, 1]), /out of order/);
  await assert.rejects(rpc(U1, "apple_submit_move", [st.run_id, 2, 0, 0, 0, 17]), /invalid selection/);
  const bad = await rpc(U1, "apple_submit_move", [st.run_id, 2, 0, 0, 0, 0]);   // 사과 1개 → 무효, 0점
  assert.deepEqual([bad.move.accepted, bad.score, bad.next_seq], [false, want, 3]);
});

test("다른 사용자의 run 접근·비인증 호출 차단 (18)", async () => {
  await allowNewRun(U1);
  const st = await rpc(U1, "apple_start_run", ["사과왕"]);
  await assert.rejects(rpc(U2, "apple_submit_move", [st.run_id, 1, 0, 0, 0, 1]), /run not found/);
  await assert.rejects(rpc(U2, "apple_finish_run", [st.run_id]), /run not found/);
  await assert.rejects(rpc(null, "apple_start_run", ["익명"]), /auth required/);
});

test("임의 점수·보드·시간을 직접 쓸 수 없음 (16): 테이블·내부 함수 접근 불가", async () => {
  for (const sql of [
    "select * from apple_private.runs",
    "update apple_private.runs set score = 99999",
    "insert into apple_private.moves (run_id, seq, selection, accepted) values (gen_random_uuid(), 1, '{0,0,0,0}', true)",
    "select apple_private.score(2, 10, 0)",
  ]) {
    await assert.rejects(call(U1, sql), /permission denied/, sql);
  }
  await db.exec(`select set_config('request.jwt.claim.sub', '${U1}', false); set role anon;`);
  await assert.rejects(db.query("select public.apple_start_run('익명')"), /permission denied/, "anon 역할은 RPC 불가");
  await db.exec("reset role;");
});

test("120초 경계: 서버 수락 시각 기준으로 만료 후 이동은 무효·자동 종료", async () => {
  await allowNewRun(U1);
  let st = await rpc(U1, "apple_start_run", ["사과왕"]);
  await ageRun(st.run_id, 121);
  const rect = findAnyValidRectangle(toBoard(st.board));
  st = await rpc(U1, "apple_submit_move", [st.run_id, 1, rect.r0, rect.c0, rect.r1, rect.c1]);
  assert.deepEqual([st.move.accepted, st.move.reason, st.score, st.status], [false, "time-up", 0, "finished"]);
  assert.equal(st.finished_at, st.expires_at, "확정 시각 = 만료 시각");
});

test("보너스 이벤트: 경과 시간만큼 서버가 1회씩 처리, 최대 3개", async () => {
  await allowNewRun(U1);
  let st = await rpc(U1, "apple_start_run", ["사과왕"]);
  await ageRun(st.run_id, 25);
  st = await rpc(U1, "apple_sync_run", [st.run_id]);
  assert.equal(st.board.filter((x) => x && x.b).length, 3);
  st = await rpc(U1, "apple_sync_run", [st.run_id]);
  await ageRun(st.run_id, 101);
  st = await rpc(U1, "apple_sync_run", [st.run_id]);
  assert.equal(st.board.filter((x) => x && x.b).length, 3, "상한 3개");
  const ev = (await admin("select processed_bonus_events as p from apple_private.runs where id = $1", [st.run_id])).rows[0].p;
  assert.deepEqual(ev, [20, 40, 60, 80, 100]);
});

test("서버 자동 복구: 판이 비면 재생성, 해가 없으면 4·6 보충, 점수 유지", async () => {
  await allowNewRun(U1);
  let st = await rpc(U1, "apple_start_run", ["사과왕"]);
  const empty = new Array(170).fill(null);
  const b1 = empty.slice(); b1[0] = { id: 1, v: 4, b: false }; b1[1] = { id: 2, v: 6, b: true };
  await admin("update apple_private.runs set board = $2::jsonb, score = 50 where id = $1", [st.run_id, JSON.stringify(b1)]);
  st = await rpc(U1, "apple_submit_move", [st.run_id, 1, 0, 0, 0, 1]);
  assert.deepEqual([st.move.recovery, st.score, st.board_index], ["regenerated-empty", 50 + 12, 2]);
  assert.equal(st.board.filter(Boolean).length, 170);
  assert.equal(st.board.filter((x) => x.b).length, 0, "제거된 보너스는 부활하지 않음");

  const b2 = empty.slice(); b2[0] = { id: 1, v: 4, b: false }; b2[1] = { id: 2, v: 6, b: false }; b2[169] = { id: 3, v: 9, b: true };
  await admin("update apple_private.runs set board = $2::jsonb where id = $1", [st.run_id, JSON.stringify(b2)]);
  st = await rpc(U1, "apple_submit_move", [st.run_id, 2, 0, 0, 0, 1]);
  assert.equal(st.move.recovery, "filled-4-6");
  const live = st.board.filter(Boolean);
  assert.equal(live.length, 3);
  assert.equal(live.filter((x) => x.b && x.id === 3).length, 1, "살아남은 보너스 유지");
  assert.ok(findAnyValidRectangle(toBoard(st.board)));
});

test("랭킹 (20): 한국 날짜 일간, 이용자별 최고 1개, 동점은 먼저 확정, 규칙 버전 분리, 닉네임 검증", async () => {
  await admin("delete from apple_private.runs");
  const mk = async (uid, nick, score, at, version = 1) => {
    const st = await rpc(uid, "apple_start_run", [nick]);
    await admin(`update apple_private.runs set status = 'finished', score = $2, finished_at = ${at},
      started_at = started_at - interval '1 day', expires_at = expires_at - interval '1 day', rules_version = $3 where id = $1`,
      [st.run_id, score, version]);
  };
  const today = "(date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')";
  await mk(U1, "가나다", 80, `${today} + interval '1 minute'`);
  await mk(U1, "가나다", 120, `${today} - interval '1 minute'`);         // 어제 23:59 (한국 시간)
  await mk(U2, "Bob_2", 80, `${today} + interval '30 seconds'`);         // U1과 동점이지만 먼저 확정
  await mk(U3, "v2player", 999, `${today} + interval '2 minutes'`, 2);   // 다른 규칙 버전

  const daily = await call(U1, "select * from public.apple_leaderboard('daily')");
  assert.deepEqual(daily.map((r) => [r.nickname, r.score]), [["Bob_2", 80], ["가나다", 80]]);
  const all = await call(U1, "select * from public.apple_leaderboard('all')");
  assert.deepEqual(all.map((r) => [r.nickname, r.score]), [["가나다", 120], ["Bob_2", 80]], "이용자별 최고 1개");
  const mine = await call(U1, "select * from public.apple_leaderboard('mine')");
  assert.deepEqual(mine.map((r) => [r.nickname, r.score]), [["최고 기록", 120], ["최근", 80], ["최근", 120]]);
  assert.ok(Object.keys(all[0]).every((k) => ["rank", "nickname", "score", "confirmed_at"].includes(k)), "user_id 등 비공개");

  await allowNewRun(U1);
  for (const bad of ["<script>", "a", "열세글자가넘는닉네임입니다", "이름 공백"]) {
    await assert.rejects(rpc(U1, "apple_start_run", [bad]), /invalid nickname/, bad);
  }
});
