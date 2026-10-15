# Apple × 10

120초 동안 17×10 사과판에서 **직사각형으로 드래그**해 숫자 합이 **10의 배수**인 사과를 없애는 퍼즐 게임.
Fruit Box의 조작 방식만 참고했고, 코드·그래픽·이름은 직접 만들었다.

- 플레이: https://rlaalswo4942.github.io/my-game/apple/
- 기반 문서: `claude_apple_game_master_prompt_v3.md` (규칙 v1)

## 파일

| 파일 | 역할 |
|---|---|
| `index.html` / `style.css` | 화면. 사과는 CSS로 그림, ★ 보너스는 테두리·배지·반짝임으로 구분 |
| `rules.js` | 규칙 순수 함수 (판정·점수·누적합 검사·보드 생성·복구·보너스). DOM 없음 |
| `session.js` | 연습 모드 상태 머신 `READY → PLAYING → RESOLVING_MOVE → (RECOVERING) → FINISHED`, 시계 주입 |
| `main.js` | 입력(Pointer Events)·렌더링·대화상자 |
| `online.js` / `config.js` | 랭킹 모드 클라이언트. `config.js`가 비어 있으면 연습 모드만 |
| `supabase/apple.sql` | 서버 권위 랭킹: 테이블·RLS·규칙 함수·RPC 5개 |
| `tests/` | 단위(`rules.test.mjs`), 브라우저(`e2e.spec.mjs`), SQL(`sql.spec.mjs`), 랭킹 통합(`online.spec.mjs`) |

## 실행

빌드 없음. ES 모듈이라 `file://`로는 안 열리고 웹 서버가 필요하다 (VS Code Live Server 또는 아래).

```bash
cd apple
npm install            # 테스트용 (playwright, pglite)만 설치됨
npm run serve          # http://localhost:5500/apple/
npm test               # 규칙 단위 테스트
npm run e2e            # 브라우저 테스트 (Playwright 1.63 + Chromium)
npm run sql            # 서버 SQL 테스트 (PGlite)
npm run online         # 랭킹 모드 통합 테스트 (브라우저 → 가짜 Supabase → PGlite)
```

## 구현 선택과 이유

- **프레임워크·빌드 없음**: GitHub Pages에 그대로 올리고, 수업 저장소(`my-game`) 구조를 유지하려고.
- **Edge Functions 대신 SQL 함수(RPC)**: 이동 판정·점수·기록을 한 트랜잭션에서 `runs` 행을 `FOR UPDATE`로 잠그고 처리 → 같은 `(runId, seq)` 동시 제출도 한 번만 반영. 함수 배포 도구 없이 SQL Editor 한 번으로 설치된다.
- **규칙 이중 구현 (JS + PL/pgSQL)**: 런타임이 달라 같은 코드를 못 쓰므로, 점수 벡터와 무작위 판 24개로 두 구현의 결과가 같은지 `sql.spec.mjs`가 교차 검증한다.
- **서버 난수**: 서버 판은 PostgreSQL `random()`으로 만든다 (클라이언트가 시드를 모름). 고정 시드 재현은 로컬 규칙(`createSeededRng`)에서 한다.
- **시간**: 연습은 `performance.now()` 기준 경과 시간(숨긴 탭에서도 흐름), 랭킹은 서버 `now()`(요청 수락 시각)가 기준.
- **랭킹 이동은 한 번에 하나**: 서버 응답을 기다리는 동안 다음 드래그를 막아 순서 역전·중복을 없앴다.

## 온라인 랭킹 연결 (현재 미연결)

1. Supabase 프로젝트 → **Authentication → Sign In / Providers → Allow anonymous sign-ins** 켜기
2. **SQL Editor**에 `supabase/apple.sql` 전체 붙여 넣고 Run
3. `config.js`에 Project URL과 **publishable(anon) 키** 입력 → 커밋·배포
   - `service_role` 키는 절대 넣지 않는다
4. 확인: 랭킹 모드로 한 판 → 랭킹 창 일간/전체/내 기록에 표시되는지, 대시보드에서 `apple_private.runs`에 행이 생겼는지

## 테스트 결과 (2026-10-15, 로컬 실행)

| # | 항목 | 결과 | 근거 |
|---|---|---|---|
| 1 | 10×17, 170칸 1~9 | Pass | `npm test` |
| 2 | 드래그 4방향 같은 사각형 | Pass | `npm test`, `npm run e2e` |
| 3 | 10/20/30/100 유효, 0/9/11/25·N<2 무효 | Pass | `npm test` |
| 4 | 점수 벡터 5개 | Pass | `npm test`, `npm run sql` (JS·SQL 동일) |
| 5 | 빈칸 가로지르기·중복 없음 | Pass | `npm test` |
| 6 | 보너스 +10/+20 | Pass | `npm test` |
| 7 | 시작 보너스 1회, 이벤트 각 1회, 최대 3개 | Pass | `npm test`, `npm run e2e`, `npm run sql` |
| 8 | 8,415개 검사 + 실제 사과 수 조건 | Pass | `npm test` (방문 수 8415 확인) |
| 9 | 해결 가능 판 미복구, 불가능 판 제한 내 복구 | Pass | `npm test`, `npm run sql` |
| 10 | 인접 빈칸 없으면 4+6 없이 재생성 | Pass | `npm test` (2×3 소형 판) |
| 11 | 판이 비면 재생성, 점수·시간·이력 유지 | Pass | `npm test`, `npm run sql` |
| 12 | 보너스 보존, 제거된 보너스 부활 없음 | Pass | `npm test`, `npm run sql` |
| 13 | pointercancel·멀티터치·우클릭·중복 pointerup·재시작 중 이벤트 | Pass | `npm run e2e` (멀티터치는 `isPrimary` 코드로만, 실기기 Not Run) |
| 14 | 119.9~120.1초, 창 크기 변경 | Pass | `npm run e2e` (가짜 시계). 숨김 탭은 단위 테스트로만 |
| 15 | 모바일 가로/세로 터치, 글자 잘림 없음 | Pass | `npm run e2e` (에뮬레이션). 실기기 Not Run |
| 16 | 임의 점수·보드·시간 반영 안 됨 | Pass | `npm run sql` (테이블·내부 함수 permission denied, API에 점수 인자 없음) |
| 17 | 같은 (runId, seq) 두 번 → 1회만 | Pass (순차) / Not Run (동시) | PGlite는 단일 연결이라 실제 동시 경합은 미재현. `FOR UPDATE` + PK로 보장하도록 작성 |
| 18 | 남의 run·비인증 쓰기 차단 | Pass | `npm run sql` |
| 19 | 연습 기록은 온라인 업로드 불가 | Pass | 업로드 경로 자체가 없음 (`npm run e2e`에서 미설정 시 랭킹 모드 비활성 확인) |
| 20 | 한국 날짜 일간, 최고 1개, 동점 먼저 확정, 버전 분리 | Pass | `npm run sql` |
| 21 | 느린 응답·서버 오류·늦은 이전 응답 | Pass | `npm run online` (가짜 Supabase) |
| — | 실제 Supabase 프로젝트 연결 | **Blocked** | 자격 증명 미설정 (위 연결 절차 필요) |

## 남은 한계

- 봇·익명 계정 여러 개는 서버 검증만으로 막을 수 없다 (규칙대로 둔 수만 점수가 되지만, 사람보다 빠른 자동 입력은 막지 못함).
- `submit-move`는 별도 속도 제한이 없다 (판당 120초 제한과 순서 번호로만 제한). `start-run`은 5초에 1판.
- 점수 공식 계수는 실제 플레이 데이터 없이 정한 초기값이다.
- 키보드만으로 드래그하는 조작은 없다.
