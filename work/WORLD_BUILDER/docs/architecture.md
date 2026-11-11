# WORLD BUILDER — 기술 아키텍처

## 1. 설계 원칙

1. **데이터가 먼저, 화면은 결과.** 모든 편집은 `WorldDocument`(프로젝트 데이터)를 바꾸고, 렌더러·패널은 문서 이벤트를 듣고 따라갑니다. 화면만 바뀌고 데이터가 안 바뀌는 경로는 없습니다.
2. **월드 좌표와 화면 좌표의 완전 분리.** 객체는 언제나 월드 좌표(px)로 저장됩니다. 카메라는 `screen = world × zoom + offset` 변환만 담당하고 객체 데이터를 건드리지 않습니다.
3. **모든 편집은 Command.** 생성·삭제·이동·크기·회전·속성·폴리곤·점 추가/삭제·레이어 변경·지형 페인트 모두 `do()/undo()`가 있는 커맨드로 기록됩니다.
4. **변경분만 기록.** 속성 변경은 바뀐 키만, 지형 페인트는 바뀐 셀만 저장합니다.
5. **프레임워크 없음.** Vanilla JS ES 모듈. 빌드 과정 없이 정적 호스팅(GitHub Pages)에서 그대로 실행됩니다.

## 2. 모듈 구성

```
                ┌──────────── panels (Inspector, Layers, Hierarchy, Asset Library, Menus) ───────────┐
                │                                                                                     │
   input ──▶ ToolManager ──▶ Tool (select / island / coastline / terrain / road / bridge / place / area)
                │                      │ commands
                ▼                      ▼
             Camera            Editor ──▶ History ──▶ Command.do()/undo()
                │                      │                     │
                │                      ▼                     ▼
                │               Selection             WorldDocument  ── events (add/remove/update/terrain/reorder/section)
                ▼                                            │
            Renderer (PixiJS) ◀───────────────────────────────┘
              ├ views (Island / Road / Bridge / Sprite / Area)
              ├ SpatialIndex (culling, hit-test)
              └ overlay (selection, handles, tool previews)

   ProjectManager ──▶ serialize / Zod schema / migrations ──▶ JSON / ZIP (JSZip) / IndexedDB (autosave, asset blobs)
```

| 폴더 | 역할 |
|---|---|
| `core/` | 프레임워크 독립적인 핵심: 문서 모델, 커맨드, 히스토리, 선택, 카메라, 공간 인덱스. Node에서 테스트 가능 |
| `objects/` | 객체 유형별 기하: 경계, 히트 테스트, 아핀 변형, 꼭짓점 편집, 지형 그리드, 도로·다리 곡선 |
| `data/` | 상수/열거형, 객체 팩토리, Zod 스키마, 직렬화, 마이그레이션, 기본 에셋 목록 |
| `renderer/` | PixiJS 렌더링: 레이어 컨테이너, 객체 뷰, 텍스처 캐시, 오버레이 |
| `tools/` | 캔버스 입력을 편집 커맨드로 바꾸는 도구들 |
| `panels/` | DOM UI. 문서/선택 이벤트에 반응 |
| `storage/` | 파일 열기/저장, ZIP, IndexedDB 자동 저장, 에셋 Blob 저장소 |
| `app/` | `Editor`(중앙 컨트롤러), 부트스트랩, 성능 테스트 |
| `nav/` | Navigator: 도로망 그래프, 길찾기, 주행 시뮬레이션, 페이지 |

## 3. 좌표계와 카메라

- `Camera { zoom, offsetX, offsetY }` — `worldToScreen`, `screenToWorld`, `zoomAt(screenPt, factor)`(커서 아래 월드 점 고정), `fitBounds`.
- 최소 배율은 기본 2%이고, 맵이 그보다 커서 한 화면에 안 들어가면 맵 크기에 맞춰 자동으로 더 낮아집니다(`Camera.minZoom`). 줌 최대 800%.
- PixiJS `world` 컨테이너에 `position = offset`, `scale = zoom` 만 적용합니다. 객체 데이터는 바뀌지 않습니다.
- 바다 텍스처는 화면 공간 `TilingSprite`로 그리고 `tilePosition/tileScale` 을 카메라에 맞춰 무한 캔버스처럼 보이게 합니다.
- 오버레이(선택 테두리, 핸들)는 월드 공간에서 그리되 선 두께·핸들 크기를 `1/zoom` 으로 보정해 화면에서 일정한 크기를 유지합니다.

## 4. 데이터 모델

`WorldDocument` 는 `layers, assets, islands, roads, bridges, buildings, facilities, objects, routes` 컬렉션과 `id → {obj, collection}` 맵을 가집니다.

- `add / remove / update(id, patch) / move / updateSection / terrainChanged` 만이 데이터를 바꾸며, 모두 이벤트를 발생시킵니다.
- `update` 는 값을 교체(shallow merge)할 뿐 내부를 수정하지 않습니다. 그래서 커맨드가 이전 값의 참조만 보관해도 안전합니다. (예외: 지형 셀 배열은 성능 때문에 제자리 수정하며 `TerrainCommand` 가 diff로 관리)
- ID는 `ISL_0001`, `RD_0001`, `BR_0001`, `BLD_0001`, `OBJ_0001`, `AREA_0001`, `LYR_0001`, `AST_0001` 형식. 불러온 ID 이후 번호부터 이어서 발급하며, 중복 ID는 문서와 파일 검증 양쪽에서 거부합니다.

### 객체 형태 두 가지
| 유형 | 저장 방식 |
|---|---|
| **Box 객체** (building, prop) | `x, y` = 앵커 지점, `width, height`, `rotation`(도), `anchorX/Y` |
| **Path 객체** (island, area, road, bridge) | 꼭짓점이 월드 좌표로 "구워진" 상태로 저장. `x, y` 는 경계 중심, `rotation` 은 누적 회전 정보(재적용 금지) |

도로·다리의 `width` 는 도로 폭/상판 폭, `height` 는 중심선 길이(읽기 전용)입니다.

## 5. Command / Undo

| 커맨드 | 용도 | 저장 내용 |
|---|---|---|
| `AddCommand` | 생성, 복제, 에셋/레이어 추가 | 객체 참조 |
| `RemoveCommand` | 삭제 | 객체 + 원래 인덱스 |
| `PatchCommand` | 이동·크기·회전·속성·폴리곤·점·레이어 변경 | **바뀐 키의 before/after만** |
| `TerrainCommand` | 지형 페인트/지우개/채우기 | 바뀐 셀 인덱스 `Uint32Array` + 이전/이후 값 `Uint8Array` |
| `MoveItemCommand` | 레이어 순서 | 이전 인덱스 |
| `SectionCommand` | 프로젝트/월드 설정 | 바뀐 키 |
| `BatchCommand` | 여러 커맨드를 한 단계로 | 하위 커맨드 |

- 드래그 편집은 `LiveEdit` 로 매 프레임 미리보기(문서 직접 갱신) 후, 마우스를 떼면 원래 값으로 되돌리고 최종 패치를 하나의 커맨드로 실행합니다. 덕분에 드래그 한 번 = Undo 한 단계.
- Inspector 숫자 입력처럼 연속 입력은 `mergeKey` 로 2.5초 안의 같은 필드 편집을 하나로 합칩니다.
- 삭제 시 참조 정리(cascade): 섬을 지우면 다리의 `startIslandId/endIslandId`, 건물·도로의 `islandId` 를 `null`로, 도로를 지우면 다른 도로의 `connections` 를 정리하는 패치가 같은 Batch에 포함됩니다. Undo하면 모두 복원됩니다.
- 히스토리 상한(기본 300, 설정 가능)을 넘으면 오래된 기록부터 버립니다.

## 6. 렌더링

- 문서 레이어마다 PixiJS 컨테이너 1개(`under / main / over` 3단). 레이어 순서·표시·투명도는 컨테이너에 반영.
- 객체마다 View 1개:
  - **IslandView**: 바깥 얕은 물 글로우 → 다각형 마스크 안에 기본 텍스처(`TilingSprite`, 월드 정렬) + 지형 캔버스 스프라이트 → 해안선(가장자리별 타입을 연속 구간으로 묶어 스트로크).
  - **RoadView**: 연석 + 노면(under), 가장자리선·차선(점선)·중앙선·일방통행 화살표(main), 교차로 원판(over).
  - **BridgeView**: 그림자, 상판 + 난간, 유형별 디테일(현수교 주탑·케이블, 철도 침목·레일, 보도교 판자, 도개교 분리선), 미연결 시 주황 점선 + 경고 아이콘.
  - **SpriteView**: 에셋 텍스처 스프라이트(앵커/크기/회전).
  - **AreaView**: 반투명 채움 + 점선 테두리.
- **텍스처 재사용**: 재질·바다 텍스처는 1회 생성 후 공유, 에셋 이미지는 에셋 ID당 1개(`AssetTextures`)를 캔버스로 래스터화해 공유합니다. 로딩 중/누락 시 플레이스홀더(누락 = 빨간 X).
- **Viewport Culling**: `SpatialIndex`(256px 균일 그리드 해시)로 화면(+여백)과 겹치는 객체만 `visible=true`. 카메라가 바뀔 때만 다시 계산합니다.
- **On-demand rendering**: PixiJS 기본 매 프레임 렌더를 끄고, 카메라·문서·오버레이·텍스처가 바뀐 프레임에만 렌더합니다(유휴 시 GPU 사용 0).
- 히트 테스트도 공간 인덱스로 후보를 좁힌 뒤 유형별 정밀 판정(다각형 내부, 폴리라인 거리 ≤ 폭/2, 회전 사각형)을 합니다.

## 7. 지형 시스템

- 섬마다 월드 정렬 셀 그리드(기본 16px) `{cellSize, originX, originY, cols, rows, cells: Uint8Array}`. 값 0 = 섬 기본 텍스처, 1~6 = Grass, Sand, Rock, Concrete, Soil, Water.
- 브러시는 섬 다각형 **마스크(셀 중심이 다각형 안)** 안에서만 칠합니다. 강도(0~1)는 중심→가장자리로 감쇠하는 확률로 적용됩니다.
- 채우기(Fill)는 같은 값으로 연결된 영역을 4방향 flood fill.
- 렌더는 셀 하나당 4px 캔버스에 재질 패턴으로 겹치는 원을 그려 자연스러운 경계를 만들고, 바뀐 영역만 다시 그립니다.
- 섬을 이동하면 그리드 원점만 이동, 회전·크기 변경·꼭짓점 편집 시에는 역변환으로 재샘플링(`refitTerrain`)합니다.
- 저장 시 RLE 문자열(`"120*0,5*2"`)로 압축.

## 8. 도로 연결(교차로)

- 도로 점은 고유 `id` 를 가집니다. 연결은 `road.connections: [{ pointId, roadId, targetPointId }]`.
- Road 도구는 다른 도로의 점에 스냅하면 연결을, 선분에 스냅하면 상대 도로에 점을 삽입하고 연결을 만듭니다.
- 연결된 점을 드래그하면 연결된 모든 도로의 점이 함께 움직입니다(`propagateRoadLinks`).

## 9. 저장소

- **JSON**: `serializeProject` → 지형 RLE 인코딩 + 다리 상태 계산. 이미지 데이터는 넣지 않고 에셋 ID와 `assets/...` 상대 경로만 저장.
- **열기**: `parseProject` = JSON 파싱 → 마이그레이션 → Zod 스키마 검증 → 무결성 검사(중복 ID 거부, 없는 레이어/섬/도로 참조 정리 + 경고, 없는 에셋 경고) → 지형 디코딩.
- **ZIP**: `<NAME>/project.world.json, assets/…, thumbnails/preview.png, metadata.json`.
- **File System Access API** 우선(같은 파일 덮어쓰기), 미지원 브라우저는 다운로드/파일 선택으로 대체.
- **IndexedDB**: `autosave` 스토어(변경 후 N초 디바운스 저장, 저장 여부 플래그 포함), `assets` 스토어(가져온 이미지 Blob). 시작 시 저장 안 된 자동 저장본이 있으면 복구 대화상자.
- **마이그레이션**: `data/migrations.js` 의 단계 배열(`from → to, up(data)`). 더 새로운 버전 파일은 열기를 거부합니다.

## 10. 성능

| 기법 | 위치 |
|---|---|
| Viewport culling | `Renderer.cull()` + `SpatialIndex` |
| 텍스처 재사용 | `textures.js` (재질/바다 캐시, 에셋 ID당 1 텍스처) |
| 공간 인덱스 | `core/spatial-index.js` (균일 그리드, 거대 객체 버킷) |
| 다각형 단순화 | Freehand 섬/영역: Ramer–Douglas–Peucker (`simplifyClosed`) |
| Undo 최적화 | 변경 키만 저장하는 패치, 지형 diff는 typed array |
| On-demand 렌더 | 변경이 있을 때만 렌더 |
| 큰 계층 목록 | 계층 패널 자식 150개 단위 제한 + 필터 |

Help ▸ Performance Test 로 5,000개 객체 월드를 만들어 팬/줌 중 FPS를 측정할 수 있습니다. 결과는 [test-results.md](test-results.md).

## 11. Navigator (`navigator.html`, `src/nav/`)

| 모듈 | 역할 |
|---|---|
| `road-graph.js` | 도로·다리를 폴리라인으로 모아 그래프 생성: 교차 지점 삽입(공간 그리드로 선분 쌍 검사), 도로 끝 자동 연결, 다리 끝 ↔ 섬 도로 연결, 좌표가 같은 점 병합. `snapToNetwork`(가장 가까운 도로 위 점), `findRoute`(Dijkstra + 이진 힙, 출발/도착을 임시 노드로 간선에 삽입, 일방통행 반영, 시간/거리 기준), `routeSteps`(같은 도로 묶기 + 좌/우/직진 판정) |
| `simulation.js` | 구간 목록 → 누적 거리·시간 트랙, `stateAt(t)` 로 위치·방향·속도·구간 계산, 포맷/CSV |
| `navigator.js` | 페이지: 지도 불러오기(편집기 자동 저장본 / 파일 / 샘플), 편집기와 같은 `Renderer` 로 지도 표시, 마커 입력, 경로 오버레이, 재생 루프, 텔레메트리, 내보내기 |

- 편집기와 같은 출처(origin)이므로 IndexedDB 자동 저장본과 에셋 이미지를 그대로 읽습니다. 편집기의 Navigator 버튼은 자동 저장을 먼저 쓴 뒤 새 탭을 엽니다.
- 차량 모드: 보행자 도로·보도교·철도교 제외, 일방통행 준수. 도보 모드: 철도교 제외, 5 km/h.

## 12. 확장 포인트 (PHASE 4)

- 모든 객체는 ID로 참조되므로 인물·사건·증거 데이터는 `buildingId`, `islandId`, `areaId` 등으로 연결할 수 있습니다.
- 건물에는 `investigatable`, `owner`, `address`, `description`, 로컬 좌표 `hitbox` 가 이미 있습니다.
- `routes` 최상위 배열, Characters / Routes / Investigation 레이어가 예약되어 있습니다.
- 새 객체 유형 추가 순서: `data/constants.js`(컬렉션) → `data/defaults.js`(팩토리) → `data/schema.js`(Zod) → `objects/shapes.js`(경계/히트/변형) → `renderer/views.js`(View) → 도구/Inspector.
