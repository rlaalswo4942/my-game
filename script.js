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

// ===== 배경: 위에서 아래로 연두 → 초록 그라데이션 =====
const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
sky.addColorStop(0, "#d8f5a2");
sky.addColorStop(1, "#69db7c");
ctx.fillStyle = sky;
ctx.fillRect(0, 0, canvas.width, canvas.height);

// ===== 사과판: 10×10, 각 사과에 1~9 숫자 =====
const numbers = [];
for (let i = 0; i < COLS * ROWS; i++) {
  numbers.push(Math.floor(Math.random() * 9) + 1);  // 1~9 중 하나
}
numbers[0] = 3;  // 첫 줄 앞의 두 사과를 3과 7로 고정 (선택 예시용)
numbers[1] = 7;

for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const x = GRID_X + col * CELL + CELL / 2;  // 사과 중심 x
    const y = GRID_Y + row * CELL + CELL / 2;  // 사과 중심 y

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

// ===== 선택 예시: 3 + 7 = 10 인 두 사과를 반투명 노란 상자로 표시 =====
ctx.fillStyle = "rgba(255, 212, 59, 0.35)";
ctx.fillRect(GRID_X, GRID_Y, CELL * 2, CELL);
ctx.strokeStyle = "#f08c00";
ctx.lineWidth = 3;
ctx.strokeRect(GRID_X, GRID_Y, CELL * 2, CELL);

// ===== 남은 시간 막대 (아직 줄어들지 않음, 4장에서 움직임) =====
ctx.fillStyle = "rgba(0, 0, 0, 0.2)";           // 빈 막대 (반투명)
ctx.fillRect(BAR_X, BAR_Y, BAR_W, BAR_H);
ctx.fillStyle = "#1971c2";                      // 남은 시간 (파랑)
ctx.fillRect(BAR_X, BAR_Y, BAR_W, BAR_H);

// ===== 글자: 제목, 점수, 남은 시간 =====
ctx.textAlign = "left";
ctx.textBaseline = "alphabetic";
ctx.fillStyle = "#2b2b2b";
ctx.font = "bold 28px sans-serif";
ctx.fillText("사과게임", 140, 48);
ctx.font = "20px sans-serif";
ctx.fillText("점수: 0", 520, 48);
ctx.fillText("시간", BAR_X - 4, BAR_Y - 10);
