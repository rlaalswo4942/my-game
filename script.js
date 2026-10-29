const canvas = document.getElementById("game");  // 이름이 "game"인 도화지를 찾는다
const ctx = canvas.getContext("2d");             // 그 도화지에 그릴 "붓"을 가져온다

// ===== 좌표와 크기 (여기 숫자만 바꾸면 위치·크기가 바뀐다) =====
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

// ===== 속도 (튜닝할 숫자) =====
const TIME_MAX = 120;         // 제한 시간 (초)
const TIME_SPEED = 1 / 60;    // 한 프레임에 줄어드는 시간 (1초에 60프레임 기준)
const DROP_SPEED = 8;         // 사과판이 한 프레임에 떨어지는 거리 (픽셀)

// ===== 조작 느낌 (튜닝할 숫자) =====
const SELECT_ALPHA = 0.35;    // 드래그 상자 투명도 (0 = 안 보임 ~ 1 = 사과가 가려짐)

// ===== 게임 상태 (루프가 돌 때마다 바뀌는 값) =====
let timeLeft = TIME_MAX;      // 남은 시간
let score = 0;                // 점수 (6주차에 오른다)
let dropY = -600;             // 사과판이 제자리에서 위로 떨어져 있는 거리 (0이면 제자리)

// ===== 입력 상태 (마우스 이벤트가 적어 두고, 게임 루프가 읽는다) =====
let isDragging = false;       // 지금 마우스를 누른 채 끌고 있는가
let startCol = 0;             // 드래그를 시작한 칸 (열, 행)
let startRow = 0;
let endCol = 0;               // 지금 마우스가 있는 칸 (열, 행)
let endRow = 0;
let sum = 0;                  // 상자 안 사과 숫자의 합
let count = 0;                // 상자 안 사과 개수

// ===== 사과 숫자: 루프마다 바뀌지 않도록 처음에 한 번만 만들어 둔다 =====
const numbers = [];
for (let i = 0; i < COLS * ROWS; i++) {
  numbers.push(Math.floor(Math.random() * 9) + 1);  // 1~9 중 하나
}
numbers[0] = 3;  // 첫 줄 앞의 두 사과를 3과 7로 고정 (드래그로 합 10 확인용)
numbers[1] = 7;

// ===== 배경 색: 위에서 아래로 연두 → 초록 그라데이션 (한 번만 만든다) =====
const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
sky.addColorStop(0, "#d8f5a2");
sky.addColorStop(1, "#69db7c");

// ===== 마우스 위치 → 사과판의 몇 열 몇 행인지 =====
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

// ===== 마우스 이벤트: 상태만 적어 둔다 (계산·그리기는 게임 루프가 한다) =====
canvas.addEventListener("mousedown", function (e) {
  if (dropY !== 0 || timeLeft === 0) return;  // 사과판이 내려오는 중이거나 시간 종료면 무시
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
document.addEventListener("mouseup", function () {
  isDragging = false;  // 손을 떼면 상자만 사라진다 (사과 제거는 6주차)
});

function gameLoop() {
  // ----- 1) 지우기: 배경으로 화면 전체를 덮는다 -----
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ----- 2) 계산 -----
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
  // 시간이 끝나면 드래그도 끝
  if (timeLeft === 0) {
    isDragging = false;
  }
  // 드래그 상자 안 사과 숫자의 합과 개수
  sum = 0;
  count = 0;
  if (isDragging) {
    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        sum = sum + numbers[row * COLS + col];
        count = count + 1;
      }
    }
  }

  // ----- 3) 그리기 -----
  // 사과판: 10×10, 각 사과에 1~9 숫자
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
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
    const boxX = GRID_X + startCol * CELL;
    const boxY = GRID_Y + startRow * CELL;
    const boxW = (endCol - startCol + 1) * CELL;
    const boxH = (endRow - startRow + 1) * CELL;
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

  // 글자: 제목, 점수, 남은 시간
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

  // 시간이 0이면 "시간 종료" 문구
  if (timeLeft === 0) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(0, 250, canvas.width, 100);
    ctx.fillStyle = "white";
    ctx.font = "bold 48px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("시간 종료", canvas.width / 2, 300);
  }

  requestAnimationFrame(gameLoop);  // 다음 프레임에 다시 부른다
}

gameLoop();  // 시동
