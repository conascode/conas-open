# WORLD BUILDER — 테스트 결과

- 실행일: 2026-11-11
- 환경: Linux 클라우드 샌드박스, Node 22, Chromium(Playwright, headless). **GPU 없음 → WebGL은 SwiftShader(소프트웨어 렌더링)**
- 결과 요약: **단위 테스트 50/50, 브라우저 E2E 130/130 통과** (OpenStreetMap 가져오기 추가 후 재실행)

## 1. 단위 테스트 (Node, `node --test tests/*.test.js`)

| 파일 | 내용 | 결과 |
|---|---|---|
| `geometry.test.js` (15) | 다각형 내부 판정, 면적/중심, 최근접점, 자기교차, RDP 단순화, 아핀 행렬, 회전 사각형, 베지어/점선/오프셋/볼록껍질, 카메라 변환·줌 기준점, 공간 인덱스, 지형 마스크·diff·flood fill, 회전 시 지형 재샘플링, RLE, 객체 변형·히트·꼭짓점 편집, 다리 연결 상태 | 15/15 |
| `project.test.js` (7) | ID 발급·중복 방지, 생성/삭제/Undo/Redo, 변경 키만 기록·병합, Batch·레이어 순서·히스토리 상한, 지형 diff Undo, 문서 이벤트 | 7/7 |
| `nav.test.js` (10) | 교차 도로 → 사거리 연결, 교차 연결 끄기, 일방통행(차량)/무시(도보), 같은 구간 출발·도착, 최단 시간 vs 최단 거리, 보행 전용 도로·다리, 다리 끝 자동 연결, 스냅 최대 거리, 샘플 지도 도달성, 주행 시간·위치·경유지·방향, 포맷/CSV | 10/10 |
| `serialization.test.js` (7) | 저장→불러오기 시 위치·속성·지형 유지, 최상위 구조, 잘못된 JSON·음수 크기·중복 ID·경로 탈출·지형 손상 오류, 끊긴 참조 정리, 0.9.0 마이그레이션·상위 버전 거부, ZIP 구조·커스텀 에셋 왕복, 샘플 프로젝트 유효성 | 7/7 |

## 2. 브라우저 E2E (Playwright, `tests/e2e/*.cjs`)

`python3 -m http.server 8765` 로 WORLD_BUILDER 폴더를 띄운 뒤 실행합니다. 실제 마우스·키보드 이벤트로 조작하고 문서 데이터를 검사합니다.

### PHASE 1 — Core Editor (`phase1.cjs`) 16/16
| 검사 | 결과 |
|---|---|
| 줌/팬 후에도 객체 월드 좌표 불변 · 화면↔월드 왕복 오차 0 | PASS |
| 휠 줌 시 커서 아래 지점 고정 | PASS |
| 클릭 선택 · 드래그 이동(50,20) · Ctrl+Z / Ctrl+Shift+Z | PASS |
| 핸들로 크기 조절(히트박스 함께 비례) · 회전 핸들 90° · Undo로 원상 복구 | PASS |
| Ctrl+드래그 박스 다중 선택(섬 위에서도) · 방향키 이동 · 한 번에 Undo | PASS |
| JSON 직렬화 왕복 후 데이터 동일 · 콘솔 오류 없음 | PASS |

### PHASE 2 — World Construction (`phase2.cjs`) 31/31
| 검사 | 결과 |
|---|---|
| Polygon 섬(클릭+더블클릭), Esc 취소, Freehand 섬 + 자동 단순화(41점 → 16점) | PASS |
| 해안선 꼭짓점 이동/추가/삭제(edgeTypes 동기화), 가장자리 Cliff 칠하기 + Undo | PASS |
| 지형 브러시(Sand 509셀), 섬 밖 무변화, 마스크 밖 셀 0개, Fill, Fill Undo, Undo 기록은 바뀐 셀만 | PASS |
| 도로 생성, 기존 점 스냅 → 교차로 연결, 선분 스냅 → 상대 도로에 점 삽입, 교차점 드래그 시 연결 도로 동시 이동, Undo | PASS |
| 섬 간 다리(제어점 포함) 연결 상태, 섬 이동 시 경고 상태, 같은 섬 끝점 거부 | PASS |
| Building 도구 배치(islandId 자동), 라이브러리 드래그 앤 드롭 배치, 히트박스 꼭짓점 편집(로컬 좌표) | PASS |
| Ctrl+D 복제(새 ID), Delete, 섬 삭제 시 참조 정리 + Undo로 복원, Area 생성 | PASS |

### PHASE 3 — Asset / Layer / Inspector / Project (`phase3.cjs`) 33/33
| 검사 | 결과 |
|---|---|
| 이미지 업로드 → 이름·카테고리·크기·Anchor·경로 저장, IndexedDB Blob 저장, 배치 | PASS |
| 사용 중 에셋 삭제 시 참조 객체 목록 경고 + 삭제 안 됨 | PASS |
| Inspector: 음수 폭 거부, 실시간 반영, 연속 입력 1단계 Undo 병합, 이름 변경, 같은 섬 다리 거부, 섬 폭 변경 시 다각형·지형 스케일 | PASS |
| 레이어 숨김/Undo, 잠금 레이어 선택 불가, 순서 변경(데이터+렌더 순서), 투명도, 생성, 선택 객체 이동, 삭제 시 객체 이동 | PASS |
| Hierarchy: 섬 아래 자식 표시, 클릭 선택 | PASS |
| ZIP 내보내기 구조(project.world.json / assets / thumbnails/preview.png / metadata.json), 커스텀 에셋 포함, JSON엔 이미지 데이터 없음 | PASS |
| **빈 브라우저 프로필에서 ZIP 가져오기** → 객체 143개와 커스텀 에셋 이미지 복원, 경고 없음 | PASS |
| 에셋 없이 JSON만 열기 → Missing Asset 경고, 깨진 JSON / 음수 크기 / 중복 ID 오류 표시 | PASS |
| 미저장 상태로 나갈 때 브라우저 경고, **새로고침 후 복구 대화상자 → 최신 편집 복구** | PASS |

### Navigator (`navigator.cjs`) 16/16
| 검사 | 결과 |
|---|---|
| 샘플 지도 로드 · 도로망 생성 | PASS |
| 클릭 2번 = 출발/도착 + 경로 계산, 현수교 경유 | PASS |
| 클릭 3번째 = 경유지 추가, 경로가 경유지를 지남 | PASS |
| 거리·시간·턴바이턴 안내 표시 | PASS |
| 실행 중 차량 이동 + 실시간 정보, `Space` 일시정지 | PASS |
| 도착까지 주행, GPS 기록 27건 + 이벤트(start / arrived Waypoint 1 / arrived Destination) | PASS |
| GPS CSV · 경로 JSON 내보내기 | PASS |
| 마커 드래그 → 재계산, 오른쪽 클릭 → 경유지 삭제 | PASS |
| 차량으로 섬(보행 전용) 도착 불가 이유 표시, 도보 모드는 보도교 경유 성공 | PASS |
| 편집기 Navigator 버튼 → 편집 중인 지도가 그대로 열림 | PASS |

### 도로 너비 (`road-width.cjs`) 14/14
| 검사 | 결과 |
|---|---|
| 도로 선택 시 옵션 바에 Road width 표시, 슬라이더·숫자·+/− 버튼 | PASS |
| `]` 넓게, `Shift+[` 10px 좁게, 숫자 칸 동기화 | PASS |
| Undo 단계별 복원 | PASS |
| 여러 도로 동시 변경, 다리 Deck width, Inspector 입력 | PASS |

### 기존 도로 끝 연결 (`road-connect.cjs`) 7/7
| 검사 | 결과 |
|---|---|
| 도로 끝을 다른 도로의 점에 놓기 → 교차로, Undo | PASS |
| 도로 끝을 다른 도로 중간에 놓기 → 교차점 삽입(T자), 교차점 이동 시 두 도로 함께 이동, Undo 한 번에 복원 | PASS |
| 도로가 없는 곳에 놓기 → 이동만 | PASS |

### OpenStreetMap 가져오기 (`osm-import.cjs`) 9/9 · 단위 `osm.test.js` 10/10
테스트 데이터: `tests/fixtures/coastal-town.osm` — openstreetmap.org Export 와 같은 XML 형식의 합성 해안 마을(이 테스트 환경에서는 OSM 서버 접속이 막혀 있어 실제 다운로드 파일로는 검증하지 못했습니다).

| 검사 | 결과 |
|---|---|
| XML/Overpass JSON/GeoJSON 파싱, 엔티티, 잘못된 파일 오류 | PASS |
| 열린 해안선(2개 way로 나뉨) → 북쪽 육지/남쪽 바다, 닫힌 해안선 → 이름 있는 섬 | PASS |
| 도로 종류·이름·제한속도·차선·일방통행(oneway=-1 반전)·주차 통로, 공유 노드 → 교차점 4개 | PASS |
| 건물 종류·이미지·주소 이름·로컬 좌표 Hitbox(꼭짓점이 OSM 외곽선과 0.5px 이내) | PASS |
| 호수·공원(multipolygon)·해변·상업지·개울 → 지형, 나무 3그루 | PASS |
| 해안선 없는 영역 = 전체 육지, 항목 끄기, 큰 영역 축척 자동 조정 | PASS |
| 편집기 메뉴 → 대화상자 → 가져오기 → 편집·Undo 가능, 상태바 출처 표시 | PASS |
| Navigator: 가져온 지도의 축척 사용, 본토 → 다리 → 섬 경로 | PASS |

### 성능 (`perf.cjs`) 4/4
| 검사 | 결과 |
|---|---|
| 5,032개 객체(섬 16, 도로 16, 건물 3,334, 나무 1,666) 생성·로드 | 691 ms |
| Viewport culling: 줌 100%에서 162 / 5,032개만 렌더 | PASS |
| 200개 객체 이동 6 ms, Undo 5 ms | PASS |
| 5,000개 스프라이트가 공유하는 텍스처 수 | 12개 |

## 3. FPS 측정과 한계 (정직한 보고)

| 측정 | 결과 |
|---|---|
| 프레임당 JS 처리(카메라·컬링·격자·오버레이), 5,032개 전부 화면에 보일 때 | 3.8 ms |
| 프레임당 드로우 제출, 5,032개 전부 보일 때 | 4.0 ms |
| 줌 0.3(849개 보임) JS / 드로우 | 0.8 ms / 1.1 ms |
| 1920×1080 화면 팬/줌 애니메이션 평균 FPS (SwiftShader) | **7.9 FPS** |
| 960×600 같은 장면 평균 FPS (SwiftShader) | **38.0 FPS** |

- 편집기 자체의 프레임당 메인 스레드 비용은 최악(전체 5,000개 표시)에서도 약 8 ms로 60 FPS 예산(16.7 ms) 안입니다.
- 화면 픽셀 수를 1/3.6로 줄이면 FPS가 4.8배 오르므로, 이 환경의 병목은 **GPU가 없는 소프트웨어 래스터화**입니다.
- **실제 GPU가 있는 PC에서의 60 FPS는 이 환경에서 측정할 수 없었습니다.** 실제 PC에서 `Help ▸ Performance Test (5,000 objects)` 로 확인할 수 있습니다.
- 유휴 상태에서는 렌더하지 않으므로(On-demand rendering) 편집 중이 아닐 때 GPU 사용량은 0입니다.

## 4. ZIP 내보내기·복구 테스트 상세

1. 샘플 프로젝트 + 직접 가져온 PNG 에셋 1개 → Export ZIP → 41개 항목(`SERIM_CITY/` 아래 project.world.json, metadata.json, thumbnails/preview.png, assets/buildings/*.svg, assets/objects/AST_0001.png 등)
2. IndexedDB가 비어 있는 새 브라우저 프로필에서 Import ZIP → 객체 143개, 커스텀 에셋 Blob 230 bytes 복원, 텍스처 `ready`, 경고 없음
3. 같은 JSON만 새 프로필에서 열기 → `Missing Asset: AST_0001 "Red Marker" (assets/objects/AST_0001.png)` 경고 + 해당 객체 빨간 X 표시
4. 편집 후 저장하지 않고 새로고침 → 브라우저 이탈 경고 → 다시 열면 "Recover unsaved work?" → Recover → 마지막 편집(이름 "Recovered Tower")과 가져온 에셋 모두 복원

## 5. 다시 실행하기

```bash
cd work/WORLD_BUILDER
```

```bash
node --test tests/*.test.js
```

```bash
python3 -m http.server 8765
```

다른 터미널에서 (Playwright + Chromium 필요):

```bash
node tests/e2e/phase1.cjs && node tests/e2e/phase2.cjs && node tests/e2e/phase3.cjs && node tests/e2e/perf.cjs && node tests/e2e/navigator.cjs && node tests/e2e/road-width.cjs && node tests/e2e/road-connect.cjs && node tests/e2e/osm-import.cjs
```
