// 로컬 연습 세션: 상태 머신 + 시간 + 보너스 이벤트 + 자동 복구. 시계(now)는 밖에서 주입한다.
// READY → PLAYING → RESOLVING_MOVE → (RECOVERING →) PLAYING → FINISHED
//   READY          : 시작만 허용
//   PLAYING        : 드래그·제출 허용
//   RESOLVING_MOVE : 입력 차단 (판정 중)
//   RECOVERING     : 입력 차단 (보드 복구 중, 시간은 계속 흐름)
//   FINISHED       : 재시작만 허용
import {
  RULES, createSeededRng, createIdGen, createStartBoard, evaluateSelection, applyRemoval,
  tryRecoverBoard, getDueBonusEvents, promoteBonus,
} from "./rules.js";

export function createSession({ seed = (Math.random() * 2 ** 32) >>> 0, rules = RULES } = {}) {
  const rng = createSeededRng(seed);
  const nextId = createIdGen();
  const s = {
    seed, rules, status: "READY", score: 0, startedAt: null, board: null,
    boardIndex: 0, processedEventIds: new Set(), lastRecovery: null, error: null,
  };

  s.remaining = (now) => (s.startedAt === null ? rules.durationMs
    : Math.max(0, rules.durationMs - (now - s.startedAt)));

  s.start = (now) => {
    if (s.status !== "READY") return false;
    s.board = createStartBoard(rng, nextId, rules);
    s.boardIndex = 1;
    s.startedAt = now;
    s.status = "PLAYING";
    return true;
  };

  // 경과 시간 이벤트 처리 + 종료 판정. 변화가 있으면 true.
  s.tick = (now) => {
    if (s.status === "READY" || s.status === "FINISHED") return false;
    let changed = false;
    for (const id of getDueBonusEvents(now - s.startedAt, s.processedEventIds, rules)) {
      s.processedEventIds.add(id);                 // 승격 실패해도 소멸 (누적 없음)
      const res = promoteBonus(s.board, rng, rules);
      s.board = res.board;
      changed = changed || res.promoted !== null;
    }
    if (s.remaining(now) <= 0) { s.status = "FINISHED"; changed = true; }
    return changed;
  };

  // 드래그 확정. 반환: { accepted, reason?, eval?, recovery? }
  s.submit = (sel, now) => {
    if (s.status !== "PLAYING") return { accepted: false, reason: "not-playing" };
    s.tick(now);                                   // 예정된 보너스 이벤트를 먼저 반영
    if (s.status !== "PLAYING") return { accepted: false, reason: "time-up" };

    s.status = "RESOLVING_MOVE";
    const ev = evaluateSelection(s.board, sel, rules);
    if (!ev.valid) { s.status = "PLAYING"; return { accepted: false, reason: "invalid", eval: ev }; }
    s.board = applyRemoval(s.board, sel);
    s.score += ev.earned;

    s.status = "RECOVERING";
    const rec = tryRecoverBoard(s.board, rng, nextId, rules);
    if (rec.error) {
      s.error = rec.error;
      s.status = "FINISHED";
      return { accepted: true, eval: ev, recovery: rec };
    }
    if (rec.action !== "none") { s.board = rec.board; s.boardIndex++; }
    s.lastRecovery = rec.action;
    s.status = "PLAYING";
    return { accepted: true, eval: ev, recovery: rec };
  };

  return s;
}
