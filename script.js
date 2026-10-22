const canvas = document.getElementById("game");  // 이름이 "game"인 도화지를 찾는다
const ctx = canvas.getContext("2d");             // 그 도화지에 그릴 "붓"을 가져온다

// ===== 4장 Step 1: 연습용 공 (3장 사과게임 화면은 Step 4에서 다시 살린다) =====

// ===== 상태 변수: 공의 위치와 속도 =====
let ballX = 100;        // 공 중심 x
let ballY = 300;        // 공 중심 y
let speedX = 4;         // 한 프레임에 x에 더하는 값
const BALL_R = 20;      // 공 반지름

function gameLoop() {
  // 1) 지우기: 지난 프레임 그림을 지운다
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 2) 계산: 위치에 속도를 더하고, 좌우 끝에 닿으면 방향을 뒤집는다
  ballX = ballX + speedX;
  if (ballX + BALL_R > canvas.width || ballX - BALL_R < 0) {
    speedX = -speedX;
  }

  // 3) 그리기: 새 위치에 흰 공을 그린다
  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.arc(ballX, ballY, BALL_R, 0, Math.PI * 2);
  ctx.fill();

  requestAnimationFrame(gameLoop);  // 다음 프레임에 다시 부른다
}

gameLoop();  // 시동
