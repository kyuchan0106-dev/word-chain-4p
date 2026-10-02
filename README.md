# 4인 끝말잇기

## 기능
- 4명까지 한 방에서 플레이
- 방 코드 생성 / 참가
- 실시간 턴 동기화
- 15초 제한시간
- 중복 단어 방지
- 앞 단어의 마지막 글자로 시작해야 함
- 시간 초과 시 탈락
- 마지막 생존자 승리
- 점수/사용 단어 표시

## 배포 — Render 기준
1. 이 폴더 전체를 GitHub 저장소에 올립니다.
2. Render에서 New → Web Service를 선택합니다.
3. GitHub 저장소를 연결합니다.
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Node 환경으로 배포합니다.
7. 생성된 `https://...onrender.com` 주소를 직원들에게 공유합니다.

## 로컬 테스트
Node.js 18 이상에서:
npm install
npm start

브라우저에서 http://localhost:3000 접속.

## 참고
현재 버전은 한국어 사전 API 없이 동작하도록 만들어졌습니다.
따라서 '한글 2글자 이상'과 끝 글자 규칙만 자동 검증합니다.
실제 국어사전 기준의 존재 단어 검증까지 원하면 사전 API를 추가할 수 있습니다.
