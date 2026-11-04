# CONAS Todo (app1)

Expo(React Native) + TypeScript로 만든 할 일 목록 앱입니다.
할 일 추가 · 완료 체크 · 삭제 · 필터(전체/할 일/완료) · 완료 항목 일괄 삭제를 지원하고, 목록은 폰에 저장됩니다(AsyncStorage).

## 폰에서 실행하기

1. 컴퓨터에 [Node.js](https://nodejs.org) (LTS) 설치
2. 폰에 **Expo Go** 앱 설치 (App Store / Play 스토어)
3. 터미널에서:

```bash
cd temp/app1
npm install
npx expo start
```

4. 화면에 뜬 QR 코드를 찍기 (아이폰은 카메라 앱, 안드로이드는 Expo Go 앱으로)

> 컴퓨터와 폰이 같은 와이파이에 있어야 합니다. 안 되면 `npx expo start --tunnel`

브라우저로 보려면 `npx expo start --web`

## 구조

```
app1/
├── App.tsx                    # 앱 시작점 (SafeArea, 상태바)
├── app.json                   # 앱 이름, 아이콘 등 설정
└── src/
    ├── TodoScreen.tsx         # 메인 화면
    ├── types.ts               # Todo, Filter 타입
    ├── hooks/useTodos.ts      # 목록 상태와 동작 (추가/체크/삭제/필터)
    ├── storage/todoStorage.ts # 폰에 저장/불러오기
    ├── theme/colors.ts        # 색상 (CONAS 팔레트)
    └── components/
        ├── TodoInput.tsx      # 입력창 + 추가 버튼
        ├── TodoItem.tsx       # 할 일 한 줄
        └── FilterTabs.tsx     # 전체/할 일/완료 탭
```

## 개발 명령어

```bash
npx tsc --noEmit           # 타입 검사
npx expo install <패키지>  # 패키지 추가 (npm install 대신)
```
