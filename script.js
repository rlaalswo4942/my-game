// 페이지 맨 아래에 오늘 날짜 표시
const today = new Date();
document.getElementById("today").textContent =
  today.getFullYear() + "년 " + (today.getMonth() + 1) + "월 " + today.getDate() + "일";

// 버튼을 누르면 페이지 전체 색 반전 (다시 누르면 원래대로)
document.getElementById("invert").addEventListener("click", function () {
  document.documentElement.classList.toggle("inverted");
});
