-- Apple × 10 온라인 랭킹 (Supabase / PostgreSQL)
-- 사용법: Supabase 대시보드 → SQL Editor에 이 파일 전체를 붙여 넣고 Run. 여러 번 실행해도 된다.
-- 사전 설정: Authentication → Sign In / Providers → "Allow anonymous sign-ins" 켜기.
--
-- 원칙: 보드·점수·시간·보너스는 전부 서버가 만든다. 브라우저는 runId, seq, 직사각형 좌표만 보낸다.
--   - 테이블과 규칙 함수는 apple_private 스키마 (API로 노출되지 않음, RLS 켜고 정책 없음 = 직접 접근 불가)
--   - 브라우저가 부를 수 있는 것은 public.apple_* 함수 5개뿐 (authenticated 역할만 실행 가능)
--   - 이동 처리는 runs 행을 FOR UPDATE로 잠그고 한 트랜잭션에서 판정·기록 → 같은 (run, seq) 동시 제출도 한 번만 반영
-- 규칙은 apple/rules.js와 같다 (17×10, 10의 배수, 점수 공식, 보너스, 3단계 복구). rules_version = 1.

create schema if not exists apple_private;
revoke all on schema apple_private from public;

-- ---------- 테이블 ----------
create table if not exists apple_private.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  nickname   text not null check (char_length(nickname) between 2 and 12 and nickname ~ '^[가-힣A-Za-z0-9_-]+$'),
  updated_at timestamptz not null default now()
);

create table if not exists apple_private.runs (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  status                 text not null default 'playing' check (status in ('playing', 'finished')),
  rules_version          int  not null,
  started_at             timestamptz not null,
  expires_at             timestamptz not null,
  finished_at            timestamptz,
  score                  int  not null default 0 check (score >= 0),
  board                  jsonb not null,          -- 170칸 (행 우선), null | {"id","v","b"}
  next_id                int  not null,
  processed_bonus_events int[] not null default '{}',
  board_index            int  not null default 1,
  next_seq               int  not null default 1
);
create index if not exists runs_user_started on apple_private.runs (user_id, started_at desc);
create index if not exists runs_rank on apple_private.runs (rules_version, score desc);

create table if not exists apple_private.moves (
  run_id      uuid not null references apple_private.runs (id) on delete cascade,
  seq         int  not null,
  selection   int[] not null,                     -- {r0, c0, r1, c1}
  accepted    boolean not null,
  reason      text,
  n           int not null default 0,
  s           int not null default 0,
  b           int not null default 0,
  earned      int not null default 0,
  recovery    text,
  received_at timestamptz not null default now(),
  primary key (run_id, seq)                       -- UNIQUE(run_id, seq)
);

alter table apple_private.profiles enable row level security;
alter table apple_private.runs     enable row level security;
alter table apple_private.moves    enable row level security;
revoke all on all tables in schema apple_private from public, anon, authenticated;

-- ---------- 규칙 (rules.js와 동일) ----------
create or replace function apple_private.score(p_n int, p_s int, p_b int) returns int
language sql immutable set search_path = '' as $$
  select case
    when p_n >= 2 and p_s >= 10 and p_s % 10 = 0 and p_b between 0 and p_n
    then p_n + least(greatest(p_n - 2, 0), 8) + 2 * least(p_s / 10 - 1, 6) + 10 * p_b
    else 0 end
$$;

-- 선택 영역의 생존 사과 수·합계·보너스 수
create or replace function apple_private.eval(p_board jsonb, r0 int, c0 int, r1 int, c1 int,
  out n int, out s int, out b int)
language plpgsql immutable set search_path = '' as $$
declare r int; c int; cell jsonb;
begin
  n := 0; s := 0; b := 0;
  for r in r0..r1 loop
    for c in c0..c1 loop
      cell := p_board -> (r * 17 + c);
      if jsonb_typeof(cell) = 'object' then
        n := n + 1;
        s := s + (cell ->> 'v')::int;
        if (cell ->> 'b')::boolean then b := b + 1; end if;
      end if;
    end loop;
  end loop;
end $$;

-- 8,415개 직사각형 중 유효한 것이 하나라도 있는지 (합계·개수 2차원 누적합)
create or replace function apple_private.find_valid(p_board jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  ps int[] := array_fill(0, array[198]);          -- (11행 × 18열) 누적합, 1부터 시작하는 배열
  pc int[] := array_fill(0, array[198]);
  r int; c int; r0 int; r1 int; c0 int; c1 int; v int; k int; n int; s int; cell jsonb;
begin
  for r in 0..9 loop
    for c in 0..16 loop
      cell := p_board -> (r * 17 + c);
      if jsonb_typeof(cell) = 'object' then v := (cell ->> 'v')::int; k := 1; else v := 0; k := 0; end if;
      ps[(r + 1) * 18 + c + 2] := v + ps[r * 18 + c + 2] + ps[(r + 1) * 18 + c + 1] - ps[r * 18 + c + 1];
      pc[(r + 1) * 18 + c + 2] := k + pc[r * 18 + c + 2] + pc[(r + 1) * 18 + c + 1] - pc[r * 18 + c + 1];
    end loop;
  end loop;
  for r0 in 0..9 loop
    for r1 in r0..9 loop
      for c0 in 0..16 loop
        for c1 in c0..16 loop
          n := pc[(r1 + 1) * 18 + c1 + 2] - pc[r0 * 18 + c1 + 2] - pc[(r1 + 1) * 18 + c0 + 1] + pc[r0 * 18 + c0 + 1];
          if n >= 2 then
            s := ps[(r1 + 1) * 18 + c1 + 2] - ps[r0 * 18 + c1 + 2] - ps[(r1 + 1) * 18 + c0 + 1] + ps[r0 * 18 + c0 + 1];
            if s >= 10 and s % 10 = 0 then return true; end if;
          end if;
        end loop;
      end loop;
    end loop;
  end loop;
  return false;
end $$;

-- 무작위 170칸. 반환 {board, next_id}
create or replace function apple_private.random_board(p_next_id int) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare cells jsonb[] := '{}'; i int;
begin
  for i in 0..169 loop
    cells := array_append(cells, jsonb_build_object('id', p_next_id, 'v', 1 + floor(random() * 9)::int, 'b', false));
    p_next_id := p_next_id + 1;
  end loop;
  return jsonb_build_object('board', to_jsonb(cells), 'next_id', p_next_id);
end $$;

-- 새 보드: 인접한 두 칸을 일반 사과 4·6으로 보장, 살아남은 보너스(최대 3개)를 다른 칸에 이식
create or replace function apple_private.generate_valid(p_next_id int, p_carry jsonb) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare res jsonb; brd jsonb; nid int; i1 int; i2 int; free int[]; k int := 1; bonus jsonb;
begin
  res := apple_private.random_board(p_next_id);
  brd := res -> 'board'; nid := (res ->> 'next_id')::int;
  if random() < 0.5 then
    i1 := floor(random() * 10)::int * 17 + floor(random() * 16)::int; i2 := i1 + 1;    -- 가로
  else
    i1 := floor(random() * 9)::int * 17 + floor(random() * 17)::int; i2 := i1 + 17;    -- 세로
  end if;
  brd := jsonb_set(brd, array[i1::text], jsonb_build_object('id', nid, 'v', 4, 'b', false));
  brd := jsonb_set(brd, array[i2::text], jsonb_build_object('id', nid + 1, 'v', 6, 'b', false));
  nid := nid + 2;
  select array_agg(g.ix order by random()) into free from generate_series(0, 169) g(ix) where g.ix not in (i1, i2);
  for bonus in select value from jsonb_array_elements(coalesce(p_carry, '[]'::jsonb)) limit 3 loop
    brd := jsonb_set(brd, array[free[k]::text], bonus);
    k := k + 1;
  end loop;
  return jsonb_build_object('board', brd, 'next_id', nid);
end $$;

-- 진행 불가 복구. 반환 {board, next_id, action}
create or replace function apple_private.recover(p_board jsonb, p_next_id int) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  live_idx int[]; live_cells jsonb[]; shuffled jsonb[]; cand jsonb; res jsonb;
  i int; t int; a int; z int; nid int := p_next_id; bonuses jsonb;
begin
  if apple_private.find_valid(p_board) then
    return jsonb_build_object('board', p_board, 'next_id', nid, 'action', 'none');
  end if;

  select array_agg(g.ix order by g.ix), array_agg(p_board -> g.ix order by g.ix) into live_idx, live_cells
  from generate_series(0, 169) g(ix) where jsonb_typeof(p_board -> g.ix) = 'object';

  if live_idx is null then                                            -- 2단계: 판이 비었음
    return apple_private.generate_valid(nid, '[]'::jsonb) || jsonb_build_object('action', 'regenerated-empty');
  end if;

  for t in 1..10 loop                                                 -- 3단계: 생존 사과만 섞기
    select array_agg(x order by random()) into shuffled from unnest(live_cells) x;
    cand := p_board;
    for i in 1..array_length(live_idx, 1) loop
      cand := jsonb_set(cand, array[live_idx[i]::text], shuffled[i]);
    end loop;
    if apple_private.find_valid(cand) then
      return jsonb_build_object('board', cand, 'next_id', nid, 'action', 'shuffled');
    end if;
  end loop;

  select p.a, p.z into a, z from (                                    -- 4단계: 인접 빈칸 두 개에 4·6
    select g.ix as a, g.ix + 1 as z from generate_series(0, 169) g(ix)
      where g.ix % 17 < 16 and jsonb_typeof(cand -> g.ix) <> 'object' and jsonb_typeof(cand -> (g.ix + 1)) <> 'object'
    union all
    select g.ix, g.ix + 17 from generate_series(0, 152) g(ix)
      where jsonb_typeof(cand -> g.ix) <> 'object' and jsonb_typeof(cand -> (g.ix + 17)) <> 'object'
  ) p order by random() limit 1;
  if a is not null then
    cand := jsonb_set(cand, array[a::text], jsonb_build_object('id', nid, 'v', 4, 'b', false));
    cand := jsonb_set(cand, array[z::text], jsonb_build_object('id', nid + 1, 'v', 6, 'b', false));
    if apple_private.find_valid(cand) then
      return jsonb_build_object('board', cand, 'next_id', nid + 2, 'action', 'filled-4-6');
    end if;
  end if;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into bonuses              -- 5단계: 전체 재생성
  from unnest(live_cells) x where (x ->> 'b')::boolean;
  for t in 1..20 loop
    res := apple_private.generate_valid(nid, bonuses);
    nid := (res ->> 'next_id')::int;
    if apple_private.find_valid(res -> 'board') then
      return res || jsonb_build_object('action', 'regenerated');
    end if;
  end loop;
  raise exception 'recovery failed';
end $$;

-- 경과 시간 보너스 이벤트 (20·40·60·80·100초, 각 1회, 동시 최대 3개). 반환 {board, processed}
create or replace function apple_private.process_events(p_board jsonb, p_started timestamptz, p_processed int[], p_now timestamptz)
returns jsonb
language plpgsql volatile set search_path = '' as $$
declare sec int; idx int; live_bonus int;
begin
  foreach sec in array array[20, 40, 60, 80, 100] loop
    if p_now >= p_started + make_interval(secs => sec) and not (sec = any(p_processed)) then
      p_processed := p_processed || sec;                              -- 승격 실패해도 소멸 (누적 없음)
      select count(*) into live_bonus from jsonb_array_elements(p_board) e
        where jsonb_typeof(e) = 'object' and (e ->> 'b')::boolean;
      if live_bonus < 3 then
        select g.ix into idx from generate_series(0, 169) g(ix)
          where jsonb_typeof(p_board -> g.ix) = 'object' and not (p_board -> g.ix ->> 'b')::boolean
          order by random() limit 1;
        if idx is not null then
          p_board := jsonb_set(p_board, array[idx::text, 'b'], 'true'::jsonb);
        end if;
      end if;
    end if;
  end loop;
  return jsonb_build_object('board', p_board, 'processed', to_jsonb(p_processed));
end $$;

create or replace function apple_private.state(r apple_private.runs, p_move jsonb default null) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'run_id', r.id, 'status', r.status, 'rules_version', r.rules_version,
    'started_at', r.started_at, 'expires_at', r.expires_at, 'finished_at', r.finished_at,
    'server_now', now(), 'score', r.score, 'board', r.board, 'board_index', r.board_index,
    'next_seq', r.next_seq, 'move', p_move)
$$;

-- 잠근 run을 현재 시각까지 진행: 보너스 이벤트 반영, 만료면 종료 처리
create or replace function apple_private.advance(inout r apple_private.runs)
language plpgsql volatile set search_path = '' as $$
declare res jsonb;
begin
  if r.status <> 'playing' then return; end if;
  res := apple_private.process_events(r.board, r.started_at, r.processed_bonus_events, least(now(), r.expires_at));
  r.board := res -> 'board';
  r.processed_bonus_events := array(select jsonb_array_elements_text(res -> 'processed')::int);
  if now() >= r.expires_at then
    r.status := 'finished';
    r.finished_at := r.expires_at;
  end if;
end $$;

create or replace function apple_private.lock_own_run(p_run_id uuid) returns apple_private.runs
language plpgsql volatile set search_path = '' as $$
declare r apple_private.runs;
begin
  if auth.uid() is null then raise exception 'auth required' using errcode = '28000'; end if;
  select * into r from apple_private.runs where id = p_run_id for update;
  if not found or r.user_id <> auth.uid() then                       -- 남의 run과 없는 run을 구분하지 않음
    raise exception 'run not found' using errcode = 'P0002';
  end if;
  return r;
end $$;

-- ---------- 브라우저가 부르는 함수 (RPC) ----------
create or replace function public.apple_start_run(p_nickname text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); nick text := btrim(p_nickname); res jsonb; brd jsonb; nid int; r apple_private.runs;
begin
  if uid is null then raise exception 'auth required' using errcode = '28000'; end if;
  if nick is null or char_length(nick) not between 2 and 12 or nick !~ '^[가-힣A-Za-z0-9_-]+$' then
    raise exception 'invalid nickname' using errcode = '22023';
  end if;
  if exists (select 1 from apple_private.runs where user_id = uid and started_at > now() - interval '5 seconds') then
    raise exception 'too many requests' using errcode = '53400';    -- 속도 제한: 5초에 1판
  end if;
  insert into apple_private.profiles (user_id, nickname) values (uid, nick)
    on conflict (user_id) do update set nickname = excluded.nickname, updated_at = now();

  res := apple_private.random_board(1);
  if not apple_private.find_valid(res -> 'board') then res := apple_private.generate_valid(1, '[]'::jsonb); end if;
  brd := res -> 'board'; nid := (res ->> 'next_id')::int;
  select jsonb_set(jsonb_set(brd, array[x[1]::text, 'b'], 'true'::jsonb), array[x[2]::text, 'b'], 'true'::jsonb)
    into brd from (select array_agg(g.ix order by random()) x from generate_series(0, 169) g(ix)) q;   -- 시작 보너스 2개

  insert into apple_private.runs (user_id, rules_version, started_at, expires_at, board, next_id)
    values (uid, 1, now(), now() + interval '120 seconds', brd, nid)
    returning * into r;
  return apple_private.state(r);
end $$;

create or replace function public.apple_submit_move(p_run_id uuid, p_seq int, p_r0 int, p_c0 int, p_r1 int, p_c1 int)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r apple_private.runs; prev apple_private.moves; ev record; earned int; rec jsonb;
  r0 int; r1 int; c0 int; c1 int; mv jsonb;
begin
  if p_seq is null or p_r0 is null or p_c0 is null or p_r1 is null or p_c1 is null
     or least(p_r0, p_r1) < 0 or greatest(p_r0, p_r1) > 9 or least(p_c0, p_c1) < 0 or greatest(p_c0, p_c1) > 16 then
    raise exception 'invalid selection' using errcode = '22023';
  end if;
  r := apple_private.lock_own_run(p_run_id);

  if p_seq < r.next_seq then                                           -- 재전송: 같은 결과를 돌려주고 다시 반영하지 않음
    select * into prev from apple_private.moves where run_id = r.id and seq = p_seq;
    return apple_private.state(r, jsonb_build_object('accepted', prev.accepted, 'reason', 'duplicate',
      'n', prev.n, 's', prev.s, 'b', prev.b, 'earned', 0, 'recovery', 'none'));
  end if;
  if p_seq > r.next_seq then raise exception 'out of order seq' using errcode = '22023'; end if;

  r0 := least(p_r0, p_r1); r1 := greatest(p_r0, p_r1);
  c0 := least(p_c0, p_c1); c1 := greatest(p_c0, p_c1);

  r := apple_private.advance(r);                                       -- 예정된 보너스 이벤트 먼저, 만료 판정은 서버 수락 시각
  if r.status <> 'playing' then
    mv := jsonb_build_object('accepted', false, 'reason', 'time-up', 'n', 0, 's', 0, 'b', 0, 'earned', 0, 'recovery', 'none');
  else
    select * into ev from apple_private.eval(r.board, r0, c0, r1, c1);
    earned := apple_private.score(ev.n, ev.s, ev.b);
    if earned > 0 then
      for i in r0..r1 loop
        for j in c0..c1 loop
          r.board := jsonb_set(r.board, array[(i * 17 + j)::text], 'null'::jsonb);
        end loop;
      end loop;
      r.score := r.score + earned;
      rec := apple_private.recover(r.board, r.next_id);
      r.board := rec -> 'board';
      r.next_id := (rec ->> 'next_id')::int;
      if rec ->> 'action' <> 'none' then r.board_index := r.board_index + 1; end if;
    end if;
    mv := jsonb_build_object('accepted', earned > 0, 'reason', case when earned > 0 then null else 'invalid' end,
      'n', ev.n, 's', ev.s, 'b', ev.b, 'earned', earned, 'recovery', coalesce(rec ->> 'action', 'none'));
  end if;

  insert into apple_private.moves (run_id, seq, selection, accepted, reason, n, s, b, earned, recovery)
    values (r.id, p_seq, array[r0, c0, r1, c1], (mv ->> 'accepted')::boolean, mv ->> 'reason',
            (mv ->> 'n')::int, (mv ->> 's')::int, (mv ->> 'b')::int, (mv ->> 'earned')::int, mv ->> 'recovery');
  r.next_seq := r.next_seq + 1;
  update apple_private.runs set status = r.status, finished_at = r.finished_at, score = r.score, board = r.board,
    next_id = r.next_id, processed_bonus_events = r.processed_bonus_events, board_index = r.board_index, next_seq = r.next_seq
    where id = r.id;
  return apple_private.state(r, mv);
end $$;

create or replace function public.apple_sync_run(p_run_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare r apple_private.runs;
begin
  r := apple_private.lock_own_run(p_run_id);
  r := apple_private.advance(r);
  update apple_private.runs set status = r.status, finished_at = r.finished_at, board = r.board,
    processed_bonus_events = r.processed_bonus_events where id = r.id;
  return apple_private.state(r);
end $$;

create or replace function public.apple_finish_run(p_run_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare r apple_private.runs;
begin
  r := apple_private.lock_own_run(p_run_id);
  r := apple_private.advance(r);
  if r.status = 'playing' then                                         -- 시간 전에 그만두기: 지금 점수로 확정
    r.status := 'finished';
    r.finished_at := now();
  end if;
  update apple_private.runs set status = r.status, finished_at = r.finished_at, board = r.board,
    processed_bonus_events = r.processed_bonus_events where id = r.id;
  return apple_private.state(r);
end $$;

-- 랭킹: daily(한국 날짜) / all / mine. 이용자별 최고 1개, 동점이면 먼저 확정된 기록 우선.
-- 끝난 run = finished 이거나 만료 시각이 지난 run (확정 시각 = finished_at, 없으면 expires_at)
create or replace function public.apple_leaderboard(p_scope text)
returns table (rank bigint, nickname text, score int, confirmed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'auth required' using errcode = '28000'; end if;
  if p_scope = 'mine' then
    return query
      with done as (
        select r.score, coalesce(r.finished_at, r.expires_at) as at from apple_private.runs r
        where r.user_id = auth.uid() and r.rules_version = 1 and (r.status = 'finished' or r.expires_at <= now()))
      (select null::bigint, '최고 기록'::text, d.score, d.at from done d order by d.score desc, d.at limit 1)
      union all
      (select row_number() over (order by d.at desc), '최근'::text, d.score, d.at from done d order by d.at desc limit 10);
    return;
  end if;
  if p_scope not in ('daily', 'all') then raise exception 'invalid scope' using errcode = '22023'; end if;
  return query
    with done as (
      select r.user_id, r.score, coalesce(r.finished_at, r.expires_at) as at from apple_private.runs r
      where r.rules_version = 1 and (r.status = 'finished' or r.expires_at <= now())),
    scoped as (
      select * from done d
      where p_scope = 'all' or (d.at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date),
    best as (
      select distinct on (s.user_id) s.user_id, s.score, s.at from scoped s order by s.user_id, s.score desc, s.at)
    select row_number() over (order by b.score desc, b.at), p.nickname, b.score, b.at
    from best b join apple_private.profiles p on p.user_id = b.user_id
    order by b.score desc, b.at
    limit 50;
end $$;

-- ---------- 권한: 브라우저(authenticated)는 RPC 5개만 ----------
revoke all on all functions in schema apple_private from public, anon, authenticated;
revoke all on function public.apple_start_run(text) from public, anon;
revoke all on function public.apple_submit_move(uuid, int, int, int, int, int) from public, anon;
revoke all on function public.apple_sync_run(uuid) from public, anon;
revoke all on function public.apple_finish_run(uuid) from public, anon;
revoke all on function public.apple_leaderboard(text) from public, anon;
grant execute on function public.apple_start_run(text) to authenticated;
grant execute on function public.apple_submit_move(uuid, int, int, int, int, int) to authenticated;
grant execute on function public.apple_sync_run(uuid) to authenticated;
grant execute on function public.apple_finish_run(uuid) to authenticated;
grant execute on function public.apple_leaderboard(text) to authenticated;
