// 랭킹 모드 통합 테스트: npm run online
// 브라우저(Playwright) → supabase-js → [요청 가로채기] → PGlite에서 실제 apple.sql 함수 실행.
// 진짜 Supabase(네트워크·PostgREST·Auth 서버)는 아니므로, 실제 프로젝트 연결 확인은 별도로 해야 한다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const FAKE = "https://fake-project.supabase.test";
const db = new PGlite();
let server, base, browser;
let submitDelayMs = 0;

before(async () => {
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon; create role authenticated;
    grant usage on schema auth to anon, authenticated;
  `);
  await db.exec(await readFile(new URL("../supabase/apple.sql", import.meta.url), "utf8"));

  server = http.createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (path.endsWith("\\") || path.endsWith("/")) path += "index.html";
    try {
      const body = await readFile(join(ROOT, path));
      res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}/apple/`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwtFor = (sub) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, role: "authenticated", exp: 4102444800 })}.sig`;
const subOf = (auth) => JSON.parse(Buffer.from((auth ?? "").replace("Bearer ", "").split(".")[1] ?? "", "base64url").toString() || "{}").sub;

// 가짜 Supabase: 익명 로그인 + /rest/v1/rpc/* 를 PGlite로 실행 (authenticated 역할)
async function handleSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  if (url.pathname === "/auth/v1/signup") {
    const id = randomUUID();
    await db.query("insert into auth.users values ($1)", [id]);
    return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({
      access_token: jwtFor(id), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: "r", user: { id, aud: "authenticated", role: "authenticated", is_anonymous: true },
    }) });
  }
  const m = url.pathname.match(/^\/rest\/v1\/rpc\/(apple_\w+)$/);
  if (!m) return route.fulfill({ status: 404, headers: cors, body: "{}" });
  const fn = m[1];
  const args = JSON.parse(req.postData() || "{}");
  if (fn === "apple_submit_move" && submitDelayMs) await new Promise((r) => setTimeout(r, submitDelayMs));
  const names = Object.keys(args);
  const named = names.map((k, i) => `${k} => $${i + 1}`).join(", ");
  const sql = fn === "apple_leaderboard" ? `select * from public.${fn}(${named})` : `select public.${fn}(${named}) as r`;
  try {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${subOf(req.headers().authorization) ?? ""}', false); set role authenticated;`);
    const rows = (await db.query(sql, names.map((k) => args[k]))).rows;
    const body = fn === "apple_leaderboard" ? rows : rows[0].r;
    return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
  } catch (err) {
    return route.fulfill({ status: 400, headers: cors, contentType: "application/json", body: JSON.stringify({ message: err.message, code: err.code }) });
  } finally {
    await db.exec("reset role;");
  }
}

async function openRanked() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/apple/config.js", (r) => r.fulfill({ contentType: "text/javascript",
    body: `export const ONLINE = { supabaseUrl: "${FAKE}", supabaseKey: "sb_publishable_test" };` }));
  await page.route(`${FAKE}/**`, handleSupabase);
  await page.goto(base);
  return { ctx, page, errors };
}

async function startRanked(page, nick) {
  await page.selectOption("#modeSel", "ranked");
  await page.click("#startBtn");
  await page.fill("#nickInput", nick);
  await page.click('#nickForm button[value="ok"]');
  await page.waitForFunction(() => window.__apple.engine?.mode === "ranked" && window.__apple.engine.status === "PLAYING", null, { timeout: 30_000 });
}

async function dragValid(page) {
  const { rect, earned } = await page.evaluate(async () => {
    const R = await import("./rules.js");
    const b = window.__apple.engine.board;
    const rect = R.findAnyValidRectangle(b);
    return { rect, earned: R.evaluateSelection(b, rect).earned };
  });
  const box = await page.locator("#board").boundingBox();
  const at = (r, c) => [box.x + (c + 0.5) * box.width / 17, box.y + (r + 0.5) * box.height / 10];
  await page.mouse.move(...at(rect.r0, rect.c0));
  await page.mouse.down();
  await page.mouse.move(...at(rect.r1, rect.c1), { steps: 3 });
  await page.mouse.up();
  return earned;
}

const dbRun = async () => (await db.query("select * from apple_private.runs order by started_at desc limit 1")).rows[0];

test("랭킹 모드: 익명 로그인 → 서버 판 → 이동은 서버가 채점 → 종료 → 랭킹 표시", async () => {
  const { ctx, page, errors } = await openRanked();
  await startRanked(page, "테스터");
  const earned = await dragValid(page);
  await page.waitForFunction((e) => window.__apple.engine.score === e, earned, { timeout: 10_000 });
  assert.equal((await dbRun()).score, earned, "DB 점수 = 화면 점수");

  // 서버 시간을 만료시키고 동기화 → 종료 모달에 서버 확정 점수
  await db.query("update apple_private.runs set expires_at = now() - interval '1 second', started_at = now() - interval '121 seconds'");
  await page.evaluate(() => window.__apple.engine.sync());
  await page.waitForSelector("#resultDlg[open]", { timeout: 10_000 });
  assert.equal(await page.textContent("#resScore"), String(earned));
  assert.match(await page.textContent("#resDetail"), /서버가 확정/);

  await page.click('#resultDlg button[value="rank"]');
  await page.waitForFunction(() => document.querySelector("#rankTable tbody tr"), null, { timeout: 10_000 });
  const firstRow = await page.locator("#rankTable tbody tr").first().textContent();
  assert.match(firstRow, /테스터/);
  assert.match(firstRow, new RegExp(String(earned)));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("21. 느린 응답 중 재시작: 이전 세션의 늦은 응답이 새 게임을 덮어쓰지 않음, 대기 중 추가 드래그 차단", async () => {
  const { ctx, page, errors } = await openRanked();
  await startRanked(page, "느린손");
  submitDelayMs = 1500;
  await dragValid(page);                                         // 응답 지연 중
  assert.equal(await page.evaluate(() => window.__apple.engine.isBusy()), true);
  await page.mouse.move(10, 10);
  await db.query("update apple_private.runs set started_at = started_at - interval '10 seconds'");  // 5초 제한 우회
  await page.click("#startBtn");                                 // 재시작
  await page.fill("#nickInput", "느린손");
  await page.click('#nickForm button[value="ok"]');
  await page.waitForFunction(() => window.__apple.engine.status === "PLAYING" && !window.__apple.engine.isBusy(), null, { timeout: 30_000 });
  const newRunScore = await page.evaluate(() => window.__apple.engine.score);
  await page.waitForTimeout(2000);                               // 이전 응답 도착 대기
  submitDelayMs = 0;
  assert.equal(newRunScore, 0);
  assert.equal(await page.evaluate(() => window.__apple.engine.score), 0, "새 게임 점수 유지");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("서버 오류 시 안내 문구, 닉네임 검증", async () => {
  const { ctx, page } = await openRanked();
  await page.selectOption("#modeSel", "ranked");
  await page.click("#startBtn");
  await page.fill("#nickInput", "<b>");
  await page.click('#nickForm button[value="ok"]');
  await page.waitForFunction(() => /2~12자/.test(document.getElementById("nickErr").textContent));
  assert.equal(await page.evaluate(() => window.__apple.engine), null, "잘못된 닉네임으로는 시작 안 됨");
  await page.click('#nickForm button[value="cancel"]');
  await page.route(`${FAKE}/rest/v1/rpc/apple_start_run`, (r) => r.abort());
  await page.click("#startBtn");
  await page.fill("#nickInput", "네트워크");
  await page.click('#nickForm button[value="ok"]');
  await page.waitForFunction(() => /연결하지 못했어요/.test(document.getElementById("status").textContent), null, { timeout: 15_000 });
  await ctx.close();
});
