const canvas = document.getElementById("game");  // 이름이 "game"인 도화지를 찾는다
const ctx = canvas.getContext("2d");             // 그 도화지에 그릴 "붓"을 가져온다

// 좌표 확인 연습: fillRect(x, y, 가로, 세로)
ctx.fillStyle = "red";            // 1. 빨간색 붓
ctx.fillRect(0, 0, 50, 50);       //    (0, 0) = 왼쪽 위 구석
ctx.fillStyle = "yellow";         // 2. 노란색 붓
ctx.fillRect(750, 0, 50, 50);     //    (750, 0) = 오른쪽 위 구석
ctx.fillStyle = "green";          // 3. 초록색 붓
ctx.fillRect(0, 550, 50, 50);     //    (0, 550) = 왼쪽 아래 구석
ctx.fillStyle = "white";          // 4. 흰색 붓
ctx.fillRect(400, 300, 20, 20);   //    (400, 300) = 가운데

// 각 사각형 옆에 좌표를 흰 글씨로 쓴다: fillText(글자, x, y)
ctx.fillStyle = "white";
ctx.font = "14px sans-serif";
ctx.fillText("(0, 0)", 56, 20);
ctx.fillText("(750, 0)", 690, 20);
ctx.fillText("(0, 550)", 56, 580);
ctx.fillText("(400, 300)", 426, 315);
