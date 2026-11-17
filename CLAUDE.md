# 시황 일지 (TradingBond)

개인 시황 기록용 단일 파일 웹앱. GitHub Pages로 배포: https://daniyalwon-pixel.github.io/TradingBond/

## 구조
- 설치형 앱(PWA): `manifest.webmanifest`, `sw.js`(index.html은 네트워크 우선·오프라인 시 저장본, 같은 출처 정적 파일만 캐시, Supabase·CDN은 통과), 아이콘 `icon-64/192/512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`. 설정 창에 '이 기기에 앱 설치' 버튼과 크롬 '바로가기 만들기(창으로 열기)' 안내. 회사 PC는 .bat 다운로드가 차단되므로 실행 파일 배포 방식은 쓰지 않는다(`MarketJournal_Desktop_Icon.bat`은 참고용으로만 남김). sw.js를 바꾸면 `CACHE` 이름의 버전을 올린다.
- `index.html` 하나에 HTML·CSS·JS가 모두 들어 있다. 빌드 도구 없음. 외부 라이브러리는 supabase-js(UMD, jsdelivr)와 Google Fonts만 사용.
- 저장소: Supabase(동기화, 기본값) 또는 브라우저 IndexedDB(이 기기에만). 설정 창에서 전환.
  - Supabase 프로젝트 `market-journal` (ap-northeast-2). 테이블 `journal`(user_id, date, data jsonb), `journal_img`(id, user_id, data=dataURL). RLS로 본인 행만 접근.
  - index.html 안의 URL과 publishable key는 공개 전제의 값이다. service_role 키 등 비밀 키는 절대 넣지 않는다.

## Edge Function `infomax` (기사 불러오기)
- 소스: `supabase/functions/infomax/index.ts`. Supabase 프로젝트에 배포되어 있음(verify_jwt=true, 함수 안에서 role=authenticated 확인).
- 입력 `{type:'close'|'pre'|'weekly', date:'YYYY-MM-DD'}` → 연합인포맥스 `[채권-마감]` / `[뉴욕 마켓 브리핑]` / `[채권-주간]` 해당일 기사의 `{title,url,date,text}`. weekly는 지정일→전날→다음날 순으로 찾는다(보통 일요일 13시 출고).
- 사이트 검색·페이지 파라미터가 서버에서 무시되므로, 날짜별 목록의 마지막 기사 번호로 범위를 잡고 출고시각 이분탐색 → AMP 페이지(articleViewAmp)를 주변부터 훑는 방식.
- 앱: Daily는 장 마감 시황·장전 시황 칸 아래, Weekly는 전주 주간시황 칸 아래 버튼(동기화 로그인 상태에서만). Weekly는 그 주 시작 전 일요일 날짜로 요청. 기존 내용이 있으면 덧붙일지 확인.
- 기사는 개인 기록용으로만 저장한다(재배포 금지).

## 데이터 모델 (journal.data)
- 문서 키(`date`): Daily `YYYY-MM-DD`, Weekly `YYYY-Www`(ISO 주차), FICC 노트 `N-<id>`(날짜는 `day` 필드).
- 공통: `p1~p3`(핵심 요약), `pnl`, `c1~c3`(코멘트), `shot1/shot2`(+`Cap`), `close`, `position`, `posNote`, `preOpen`, `plan`, `fav`.
- 매매 실행: 데이 트레이딩 `dt1~dt4`, 스윙 및 장기 트레이딩 `sw1~sw4` (각 1 매매 대상 및 사이즈 / 2 진입 및 청산 / 3 최종손익 / 4 복기). 예전 단일 칸 `exec`는 내용이 있을 때만 '매매 실행 (기존 기록)'으로 표시.
- 장전·매매 패널 순서: 장전 매매 계획 → [Weekly만: 전주 주간시황 `wkMkt` → 복기 `review`] → (기존 기록) → 데이 트레이딩 → 스윙 및 장기 트레이딩 → 장전 시황.
- 사진: `<field>Img` 배열(이미지 id) → `journal_img`. FICC 노트는 `title`, `body`, `bodyImg`.
- 데이터 구조를 바꿀 때는 `norm()`에서 기존 데이터를 변환해 하위 호환을 유지한다.

## 화면
- 사이드바: 검색 바(접이식) → 목록(섹션 이름·건수·새 문서 버튼) → 하단 섹션 버튼 ★ / W_T / Weekly / Daily / FICC.
- 문서: PC는 본문 + 오른쪽 '장전 · 매매' 패널(preOpen·plan·exec), 본문과 같은 폭(1:1), 1180px 이하에서는 아래로 쌓임. 모바일(≤820px)은 두 화면을 좌우로 넘김.
- 모바일 뒤로가기 = 목록 복귀(history API). 라이트/다크 모드 모두 지원.
- W_T 섹션(`section='trade'`, 목록 제목 'Weekly Trade'): 목록은 주차별이고, 주차를 누르면 그 주(월~일) Daily 문서의 데이·스윙 트레이딩(`dt*`/`sw*`, 기존 `exec` 포함)을 날짜순으로 모은 읽기 전용 화면(`renderTrade`). 데이 트레이딩 / 스윙 트레이딩 두 패널(PC는 위아래, 모바일은 좌우 넘김). 각 패널은 일자별 표: 날짜 | 최종손익(`*3`) | 매매 대상 및 사이즈(`*1`) | 진입 및 청산(`*2`, 사진 포함) | 복기(`*4`). 모바일에서는 표가 날짜별 카드로 바뀜. 기존 `exec`는 스윙 패널 뒤에 별도 묶음. 데이 패널 상단에 주간 합산 손익·승률·매매 건수(`pnlValue`: 매매별 손익을 백 단위로 환산, 억×100·천만×10·만÷100; 승률=이익/(이익+손실), 보합 제외). 복기 칸은 4줄 초과 글과 사진을 접고 '더보기'. 손익 색은 `colorPnl`: '1.-0.9백 2.+0.3백'처럼 매매 번호(N.)를 떼고 부호로 판단해 매매별로 색칠. Trade는 연보라(`--band3`) 톤. 날짜를 누르면 해당 Daily로 이동. 저장 데이터 없음(조회 전용).

## 작업 규칙
1. 수정 후 반드시 브라우저로 확인: PC(1440·1280px)와 모바일(390·360px), 라이트·다크. 콘솔 오류와 가로 넘침이 없어야 한다.
2. 설정 창 맨 아래 `앱 버전 YYYY.MM.DD-x` 문구를 매번 올린다(캐시 확인용).
3. 백업 JSON, 스크린샷, 개인 기록 파일은 절대 커밋하지 않는다(공개 저장소).
4. 확인이 끝나면 `main`에 커밋하고 push한다. 커밋 메시지는 한국어로 변경 내용을 요약한다.
5. 사용자와는 한국어로 대화한다.
