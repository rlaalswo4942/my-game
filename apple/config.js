// 온라인 랭킹 연결 정보. 비워 두면 "연습(로컬) 모드"만 동작한다.
// publishable(anon) 키만 넣는다 — 공개돼도 되는 키이고, 실제 보호는 supabase/apple.sql의 함수·RLS가 한다.
// service_role(secret) 키는 절대 여기나 Git에 넣지 말 것.
export const ONLINE = {
  supabaseUrl: "",
  supabaseKey: "",
};
