// ==========================================================
// ① 준비 — 도화지와 붓, 설정 숫자, 배경 색
// ==========================================================
const canvas = document.getElementById("game");  // 이름이 "game"인 도화지를 찾는다
const ctx = canvas.getContext("2d");             // 그 도화지에 그릴 "붓"을 가져온다

// --- 좌표와 크기 (여기 숫자만 바꾸면 위치·크기가 바뀐다) ---
const COLS = 10;          // 가로 사과 수
const ROWS = 10;          // 세로 사과 수
const CELL = 52;          // 사과 한 칸 크기
const GRID_X = 140;       // 사과판 왼쪽 위 x
const GRID_Y = 70;        // 사과판 왼쪽 위 y
const APPLE_R = 22;       // 사과 반지름
const APPLE_COLOR = "#e03131";
const BAR_X = 700;        // 남은 시간 막대 x
const BAR_Y = 70;         // 남은 시간 막대 y
const BAR_W = 24;         // 막대 가로
const BAR_H = 520;        // 막대 세로

// --- 속도 (튜닝할 숫자) ---
const TIME_MAX = 120;         // 제한 시간 (초)
const TIME_SPEED = 1 / 60;    // 한 프레임에 줄어드는 시간 (1초에 60프레임 기준)
const DROP_SPEED = 8;         // 사과판이 한 프레임에 떨어지는 거리 (픽셀)

// --- 조작 느낌 (튜닝할 숫자) ---
const SELECT_ALPHA = 0.35;    // 드래그 상자 투명도 (0 = 안 보임 ~ 1 = 사과가 가려짐)

// --- 최고 점수 저장 이름 (브라우저 localStorage의 열쇠) ---
const BEST_KEY = "appleGameBest";

// --- 배경 색: 위에서 아래로 연두 → 초록 그라데이션 (한 번만 만든다) ---
const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
sky.addColorStop(0, "#d8f5a2");
sky.addColorStop(1, "#69db7c");

// ==========================================================
// ② 상태 변수 — 게임이 돌면서 바뀌는 값
// ==========================================================
// --- 게임 상태 ---
let gameState = "start";      // "start"(시작 화면) → "playing"(플레이) → "gameover"(시간 종료)
let timeLeft = TIME_MAX;      // 남은 시간
let score = 0;                // 점수 (지운 사과 1개당 1점)
let dropY = -600;             // 사과판이 제자리에서 위로 떨어져 있는 거리 (0이면 제자리)
// 최고 점수: 저장된 값은 글자라서 Number()로 숫자로 바꾼다. 저장된 게 없으면(null) 0
let bestScore = Number(localStorage.getItem(BEST_KEY)) || 0;
let isNewRecord = false;      // 이번 판에 최고 점수를 새로 세웠는가

// --- 입력 상태 (마우스 이벤트가 적어 두고, 게임 루프가 읽는다) ---
let isDragging = false;       // 지금 마우스를 누른 채 끌고 있는가
let startCol = 0;             // 드래그를 시작한 칸 (열, 행)
let startRow = 0;
let endCol = 0;               // 지금 마우스가 있는 칸 (열, 행)
let endRow = 0;

// --- 선택 상자 (게임 루프가 시작 칸·끝 칸으로 계산한다) ---
let selLeft = 0;              // 상자의 왼쪽·오른쪽 열 (어느 방향으로 끌어도 왼쪽 <= 오른쪽)
let selRight = 0;
let selTop = 0;               // 상자의 위쪽·아래쪽 행
let selBottom = 0;
let sum = 0;                  // 상자 안 사과 숫자의 합
let count = 0;                // 상자 안 사과 개수

// --- 디버그 ---
let showDebug = false;        // true면 왼쪽에 상태 표시 (D 키로 켜고 끈다, 제출할 때는 false)

// --- 사과 숫자: 판마다 한 번만 만들어 둔다 (resetGame), 0이면 지워진 빈 칸 ---
let numbers = [];

// ==========================================================
// ③ 이벤트 — 상태만 적어 둔다 (계산·그리기는 게임 루프가 한다)
// ==========================================================
canvas.addEventListener("mousedown", function (e) {
  if (gameState === "start") {   // 시작 화면에서는 클릭해도 시작
    resetGame();
    return;
  }
  if (gameState !== "playing" || dropY !== 0) return;  // 플레이 중이 아니거나 사과판이 내려오는 중이면 무시
  const cell = cellAt(e);
  startCol = cell.col;
  startRow = cell.row;
  endCol = cell.col;
  endRow = cell.row;
  isDragging = true;
});
canvas.addEventListener("mousemove", function (e) {
  if (!isDragging) return;
  const cell = cellAt(e);
  endCol = cell.col;
  endRow = cell.row;
});
// 캔버스 밖에서 손을 떼도 드래그가 끝나도록 document에 건다
// 손을 뗐을 때 합이 딱 10이면 상자 안 사과를 지우고, 지운 개수만큼 점수
document.addEventListener("mouseup", function () {
  if (isDragging && sum === 10) {
    for (let row = selTop; row <= selBottom; row++) {
      for (let col = selLeft; col <= selRight; col++) {
        numbers[row * COLS + col] = 0;
      }
    }
    score = score + count;
  }
  isDragging = false;
});
// 키: D 디버그, 시작 화면에서는 아무 키나 시작, 시간 종료 뒤에는 R 재시작
// (e.code는 한글 입력 상태여도 "KeyD", "KeyR")
document.addEventListener("keydown", function (e) {
  if (e.code === "KeyD") {
    showDebug = !showDebug;
    return;
  }
  if (gameState === "start") {
    resetGame();
  } else if (gameState === "gameover" && e.code === "KeyR") {
    resetGame();
  }
});

// ==========================================================
// ④ 함수들
// ==========================================================
// 마우스 위치 → 사과판의 몇 열 몇 행인지
function cellAt(e) {
  const rect = canvas.getBoundingClientRect();   // 캔버스가 화면에서 어디 있는지
  const mouseX = e.clientX - rect.left;          // 캔버스 기준 x
  const mouseY = e.clientY - rect.top;           // 캔버스 기준 y
  let col = Math.floor((mouseX - GRID_X) / CELL);
  let row = Math.floor((mouseY - GRID_Y) / CELL);
  // 판 밖으로 끌어도 가장자리 칸에서 멈춘다
  if (col < 0) col = 0;
  if (col > COLS - 1) col = COLS - 1;
  if (row < 0) row = 0;
  if (row > ROWS - 1) row = ROWS - 1;
  return { col: col, row: row };
}

// 새 판 시작: 판마다 바뀌는 값을 전부 처음으로 되돌린다
function resetGame() {
  numbers = [];
  for (let i = 0; i < COLS * ROWS; i++) {
    numbers.push(Math.floor(Math.random() * 9) + 1);  // 1~9 중 하나
  }
  score = 0;
  timeLeft = TIME_MAX;
  dropY = -600;
  isDragging = false;
  isNewRecord = false;
  gameState = "playing";
}

// 시간 종료: 지금 점수가 최고 점수보다 높을 때만 갱신하고 저장한다
function endGame() {
  gameState = "gameover";
  isDragging = false;
  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem(BEST_KEY, bestScore);
    isNewRecord = true;
  }
}

// 가운데 정렬 글자 한 줄
function centerText(text, y, font, color) {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, y);
}

// 시작 화면: 제목, 목표, 조작법, 최고 점수, 깜빡이는 시작 안내
function drawStartScreen() {
  centerText("사과게임", 190, "bold 64px sans-serif", "#c92a2a");
  centerText("합이 10이 되게 사과를 묶어서 지우세요", 280, "22px sans-serif", "#2b2b2b");
  centerText("마우스로 끌어서 직사각형 선택 · 제한 시간 " + TIME_MAX + "초", 320, "18px sans-serif", "#2b2b2b");
  centerText("최고 점수: " + bestScore, 380, "bold 20px sans-serif", "#1971c2");
  if (Math.floor(Date.now() / 500) % 2 === 0) {   // 0.5초마다 보였다 안 보였다
    centerText("아무 키나 눌러 시작 (클릭해도 시작)", 470, "18px sans-serif", "#2b2b2b");
  }
}

// 시간 종료 화면: 최종 점수, 최고 점수, 신기록, 재시작 안내
function drawGameOver() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.fillRect(0, 180, canvas.width, 240);
  centerText("시간 종료", 225, "bold 48px sans-serif", "white");
  centerText("최종 점수: " + score, 285, "bold 26px sans-serif", "white");
  centerText("최고 점수: " + bestScore, 325, "22px sans-serif", "#a5d8ff");
  if (isNewRecord) {
    centerText("신기록!", 360, "bold 22px sans-serif", "#ffd43b");
  }
  centerText("R 키로 다시 시작", 395, "16px sans-serif", "#dee2e6");
}

// 디버그 표시: 지금 게임 안의 값을 왼쪽 빈 곳에 작은 글씨로 보여 준다
function drawDebug() {
  let state = gameState;
  if (gameState === "playing" && dropY !== 0) state = "playing(drop)";
  const lines = [
    "[DEBUG] D키",
    "state: " + state,
    "score: " + score,
    "best: " + bestScore,
    "time: " + timeLeft.toFixed(1),
    "dropY: " + dropY,
    "drag: " + isDragging,
    "start: " + startCol + "," + startRow,
    "end: " + endCol + "," + endRow,
    "sum: " + sum + " / " + count + "개",
  ];
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.fillRect(4, 64, 132, lines.length * 16 + 8);
  ctx.fillStyle = "#b2f2bb";
  ctx.font = "12px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], 10, 70 + i * 16);
  }
}

// ==========================================================
// ⑤ 게임 루프 — 지우기 / 계산 / 그리기를 1초에 60번
// ==========================================================
function gameLoop() {
  // ----- 1) 지우기: 배경으로 화면 전체를 덮는다 -----
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ----- 시작 화면: 사과판 없이 안내만 그리고 끝 -----
  if (gameState === "start") {
    drawStartScreen();
    if (showDebug) {
      drawDebug();
    }
    requestAnimationFrame(gameLoop);
    return;
  }

  // ----- 2) 계산 (플레이 중일 때만) -----
  if (gameState === "playing") {
    // 사과판: 아래로 떨어지다가 제자리(0)에 닿으면 멈춘다
    dropY = dropY + DROP_SPEED;
    if (dropY > 0) {
      dropY = 0;
    }
    // 시간: 사과판이 다 내려온 뒤부터 줄어들고, 0에서 멈춘다
    if (dropY === 0) {
      timeLeft = timeLeft - TIME_SPEED;
    }
    if (timeLeft < 0) {
      timeLeft = 0;
    }
    // 시간이 끝나면 게임 오버 (최고 점수 확인은 endGame에서 한 번만)
    if (timeLeft === 0) {
      endGame();
    }
  }
  // 선택 상자 범위: 시작 칸과 끝 칸 중 작은 쪽이 왼쪽·위 (오른쪽→왼쪽, 아래→위로 끌어도 맞게)
  selLeft = Math.min(startCol, endCol);
  selRight = Math.max(startCol, endCol);
  selTop = Math.min(startRow, endRow);
  selBottom = Math.max(startRow, endRow);
  // 드래그 상자 안 사과 숫자의 합과 개수 (지워진 빈 칸은 세지 않는다)
  sum = 0;
  count = 0;
  if (isDragging) {
    for (let row = selTop; row <= selBottom; row++) {
      for (let col = selLeft; col <= selRight; col++) {
        const n = numbers[row * COLS + col];
        if (n > 0) {
          sum = sum + n;
          count = count + 1;
        }
      }
    }
  }

  // ----- 3) 그리기 -----
  // 사과판: 10×10, 각 사과에 1~9 숫자 (0은 지워진 칸이라 안 그린다)
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (numbers[row * COLS + col] === 0) continue;
      const x = GRID_X + col * CELL + CELL / 2;          // 사과 중심 x
      const y = GRID_Y + row * CELL + CELL / 2 + dropY;  // 사과 중심 y (떨어지는 만큼 위로)

      // 사과 몸통 (빨간 원)
      ctx.fillStyle = APPLE_COLOR;
      ctx.beginPath();
      ctx.arc(x, y, APPLE_R, 0, Math.PI * 2);
      ctx.fill();

      // 꼭지 (초록 잎, 원 위에 겹쳐 그리기)
      ctx.fillStyle = "#2f9e44";
      ctx.beginPath();
      ctx.ellipse(x + 6, y - APPLE_R + 2, 7, 4, -0.5, 0, Math.PI * 2);
      ctx.fill();

      // 숫자 (흰 글씨, 사과 가운데)
      ctx.fillStyle = "white";
      ctx.font = "bold 20px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(numbers[row * COLS + col], x, y + 1);
    }
  }

  // 드래그 상자: 합이 10이면 초록, 아니면 흰색
  if (isDragging) {
    const boxX = GRID_X + selLeft * CELL;
    const boxY = GRID_Y + selTop * CELL;
    const boxW = (selRight - selLeft + 1) * CELL;
    const boxH = (selBottom - selTop + 1) * CELL;
    if (sum === 10) {
      ctx.fillStyle = "rgba(64, 192, 87, " + SELECT_ALPHA + ")";
      ctx.strokeStyle = "#2f9e44";
    } else {
      ctx.fillStyle = "rgba(255, 255, 255, " + SELECT_ALPHA + ")";
      ctx.strokeStyle = "white";
    }
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.lineWidth = 3;
    ctx.strokeRect(boxX, boxY, boxW, boxH);
  }

  // 남은 시간 막대: 남은 시간만큼만 파랗게, 아래쪽에 붙여서 위에서부터 줄어든다
  const barFill = BAR_H * (timeLeft / TIME_MAX);
  ctx.fillStyle = "rgba(0, 0, 0, 0.2)";           // 빈 막대 (반투명)
  ctx.fillRect(BAR_X, BAR_Y, BAR_W, BAR_H);
  ctx.fillStyle = "#1971c2";                      // 남은 시간 (파랑)
  ctx.fillRect(BAR_X, BAR_Y + BAR_H - barFill, BAR_W, barFill);

  // 글자: 제목, 점수, 최고 점수, 남은 시간
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#2b2b2b";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText("사과게임", 140, 48);
  ctx.font = "20px sans-serif";
  ctx.fillText("점수: " + score, 520, 48);
  ctx.fillText("시간 " + Math.ceil(timeLeft), BAR_X - 16, BAR_Y - 10);
  if (isDragging) {
    ctx.fillText("합계 " + sum + " · 사과 " + count + "개", 300, 48);
  }
  ctx.font = "16px sans-serif";
  ctx.fillText("최고 " + bestScore, 625, 48);

  // 시간 종료 화면
  if (gameState === "gameover") {
    drawGameOver();
  }

  // 디버그 표시 (맨 마지막에 그려서 다른 그림 위에 보이게)
  if (showDebug) {
    drawDebug();
  }

  requestAnimationFrame(gameLoop);  // 다음 프레임에 다시 부른다
}

// ==========================================================
// ⑥ 시동
// ==========================================================
gameLoop();
