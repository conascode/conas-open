# CONAS 회사 소개 사이트 — ver1

빌드 도구 없이 바로 열리는 정적 사이트입니다. 모바일 우선(mobile-first)으로 만들었습니다.

## 구조

```
ver1/
├── index.html                 # 페이지 마크업
└── assets/
    ├── css/
    │   ├── tokens.css         # 색상·글꼴·간격 변수 (디자인 바꿀 때 여기부터)
    │   ├── base.css           # 리셋, 기본 요소 스타일
    │   ├── layout.css         # 헤더·섹션·푸터 레이아웃
    │   └── components.css     # 버튼, 카드, 프로젝트 목록 등
    ├── js/
    │   ├── main.js            # 진입점 (모듈 연결)
    │   ├── data/projects.js   # 프로젝트 목록 데이터
    │   └── modules/
    │       ├── nav.js         # 모바일 메뉴, 스크롤 시 헤더
    │       ├── reveal.js      # 스크롤 등장 애니메이션
    │       └── projects.js    # 프로젝트 카드 렌더링
    └── img/                   # 로고, 파비콘
```

## 로컬에서 보기

ES 모듈을 쓰기 때문에 파일을 더블클릭하면 JS가 동작하지 않습니다. 간단한 서버로 여세요.

```bash
cd temp/ver1
python3 -m http.server 8000
# http://localhost:8000
```

## 자주 고치는 곳

- 프로젝트 추가/수정: `assets/js/data/projects.js`
- 색상·글꼴: `assets/css/tokens.css`
- 연락처 메일: `index.html` 의 Contact 섹션 (`TODO` 표시)
