// 온라인 랭킹 모드: 보드·점수·시간은 전부 서버(Supabase SQL 함수)가 정하고, 브라우저는 결과를 그리기만 한다.
// 브라우저가 보내는 것은 runId, seq, 직사각형 좌표뿐이다.
import { ONLINE } from "./config.js";
import { RULES } from "./rules.js";

export const onlineConfigured = Boolean(ONLINE.supabaseUrl && ONLINE.supabaseKey);

let client = null;

async function getClient() {
  if (!onlineConfigured) throw new Error("not-configured");
  if (!client) {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
    client = createClient(ONLINE.supabaseUrl, ONLINE.supabaseKey);
  }
  const { data } = await client.auth.getSession();
  if (!data.session) {
    const { error } = await client.auth.signInAnonymously();
    if (error) throw error;
  }
  return client;
}

async function rpc(name, args = {}) {
  const c = await getClient();
  const { data, error } = await c.rpc(name, args);
  if (error) throw error;
  return data;
}

// 서버 보드(170칸 1차원, null | {id, v, b}) → board[row][col]
export function toBoard(flat, rules = RULES) {
  return Array.from({ length: rules.rows }, (_, r) =>
    Array.from({ length: rules.cols }, (_, c) => {
      const x = flat[r * rules.cols + c];
      return x ? { id: x.id, value: x.v, isBonus: Boolean(x.b) } : null;
    }));
}

export function createRankedEngine(rules = RULES) {
  let run = null;          // 서버가 돌려준 최신 상태
  let offset = 0;          // 서버 시계 - 내 시계 (ms)
  let pending = false;     // 이동은 한 번에 하나씩만 (순서 역전·중복 방지)
  let syncing = false;
  let nextSyncAt = Infinity;
  let dirty = false;       // 서버 응답으로 판이 바뀌었는지 (화면 루프가 다시 그리도록)

  const e = { mode: "ranked", status: "READY", score: 0, board: null, boardIndex: 0, error: null };

  function apply(st) {
    if (run && st.run_id !== run.run_id) return false;   // 이전 세션의 늦은 응답은 버림
    run = st;
    e.board = toBoard(st.board, rules);
    e.score = st.score;
    e.boardIndex = st.board_index;
    e.status = st.status === "playing" ? "PLAYING" : "FINISHED";
    dirty = true;
    const elapsed = Date.parse(st.server_now) - Date.parse(st.started_at);
    const due = rules.bonusEventSeconds.map((s) => s * 1000).find((t) => t > elapsed);
    nextSyncAt = Date.parse(st.started_at) + (due ?? rules.durationMs) + 300;  // 다음 보너스 시점에 다시 동기화
    return true;
  }

  const serverNow = () => Date.now() + offset;
  e.remaining = () => (run ? Math.max(0, Date.parse(run.expires_at) - serverNow()) : rules.durationMs);

  e.start = async (nickname) => {
    const t0 = Date.now();
    const st = await rpc("apple_start_run", { p_nickname: nickname });
    offset = Date.parse(st.server_now) - (t0 + Date.now()) / 2;
    run = null;
    apply(st);
  };

  e.sync = async () => {
    if (!run || syncing) return;
    syncing = true;
    try { apply(await rpc("apple_sync_run", { p_run_id: run.run_id })); }
    catch (err) { e.error = "network"; }
    finally { syncing = false; }
  };

  e.submit = async (sel) => {
    if (e.status !== "PLAYING") return { accepted: false, reason: "not-playing" };
    if (pending) return { accepted: false, reason: "busy" };
    pending = true;
    const runId = run.run_id;
    try {
      const st = await rpc("apple_submit_move", {
        p_run_id: runId, p_seq: run.next_seq, p_r0: sel.r0, p_c0: sel.c0, p_r1: sel.r1, p_c1: sel.c1,
      });
      if (!apply(st)) return { accepted: false, reason: "stale" };
      const m = st.move;
      return {
        accepted: m.accepted, reason: m.reason,
        eval: { N: m.n, S: m.s, B: m.b, earned: m.earned, valid: m.accepted },
        recovery: { action: m.recovery },
      };
    } catch (err) {
      e.error = "network";
      await e.sync();                                    // 실패하면 서버 상태로 다시 맞춤
      return { accepted: false, reason: "network" };
    } finally {
      pending = false;
    }
  };

  // 화면 루프에서 호출. 보너스 시점·만료 시점에만 서버와 동기화한다.
  e.tick = () => {
    if (e.status === "PLAYING" && serverNow() >= nextSyncAt) { nextSyncAt = Infinity; e.sync(); }
    const changed = dirty;
    dirty = false;
    return changed;
  };

  e.finish = async () => {
    const st = await rpc("apple_finish_run", { p_run_id: run.run_id });
    apply(st);
    return { score: st.score };
  };

  e.isBusy = () => pending;
  return e;
}

export async function fetchLeaderboard(scope) {
  return rpc("apple_leaderboard", { p_scope: scope });
}
