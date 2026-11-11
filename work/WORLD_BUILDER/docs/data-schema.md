# WORLD BUILDER — JSON 데이터 구조 (schema 1.0.0)

프로젝트 파일(`*.world.json`, ZIP 안의 `project.world.json`)의 형식입니다. 검증 규칙의 원본은 `src/data/schema.js`(Zod)입니다.

## 공통 규칙

- **좌표**: 모두 월드 좌표(px). 원점은 왼쪽 위, x는 오른쪽, y는 아래쪽이 +. 기본 월드는 12000 × 12000.
- **회전**: 도(degree), 시계 방향 +.
- **ID**: `^[A-Za-z0-9_-]+$`, 프로젝트 전체에서 유일. 접두사: `ISL_` 섬, `RD_` 도로, `BR_` 다리, `BLD_` 건물, `OBJ_` 오브젝트/시설, `AREA_` 영역, `LYR_` 레이어, `AST_` 에셋.
- **참조**: `layer`, `assetId`, `islandId`, `startIslandId`, `endIslandId`, `connections[].roadId` 는 다른 객체의 ID. 없는 ID는 불러올 때 경고 후 `null` 로 정리됩니다(에셋은 Missing Asset 경고).
- **이미지 데이터는 JSON에 넣지 않습니다.** 에셋은 ID + 상대 경로(`assets/...`)만 저장합니다.

## 최상위 구조

```json
{
  "project":   { "id": "PROJECT_001", "name": "SERIM_CITY", "version": "1.0.0", "createdAt": "ISO-8601", "updatedAt": "ISO-8601" },
  "world":     { "width": 12000, "height": 12000, "background": "#173B50", "gridSize": 64 },
  "layers":    [ Layer ],
  "assets":    [ Asset ],
  "islands":   [ Island ],
  "roads":     [ Road ],
  "bridges":   [ Bridge ],
  "buildings": [ Building ],
  "facilities":[ Prop (category = "Facilities") ],
  "objects":   [ Prop | Area ],
  "routes":    [ ],
  "metadata":  { }
}
```

| 키 | 설명 |
|---|---|
| `layers` | 배열 순서 = 그리기 순서(0번이 가장 아래) |
| `facilities` | Facilities 카테고리 에셋으로 만든 객체 |
| `objects` | 그 외 에셋 객체(나무, 차량, 기타)와 영역(Area) |
| `routes` | PHASE 4(이동 경로)용으로 예약. 현재 편집기는 비워 두며 내용은 그대로 보존합니다 |
| `metadata` | 자유 형식 키-값 |

## 공통 객체 필드 (Base)

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 고유 ID |
| `type` | `"island" \| "road" \| "bridge" \| "building" \| "prop" \| "area"` | 객체 유형 |
| `name` | string | 이름 |
| `layer` | string | 레이어 ID |
| `x`, `y` | number | Box 객체: 앵커 지점. Path 객체: 경계 상자 중심 |
| `width`, `height` | number > 0 | Box: 크기. 섬/영역: 경계 크기. 도로/다리: `width` = 도로·상판 폭, `height` = 중심선 길이 |
| `rotation` | number | Box: 실제 회전. Path: 누적 회전 정보(꼭짓점에 이미 반영됨, 게임에서 다시 적용하지 말 것) |
| `visible`, `locked` | boolean | 표시 / 잠금 |
| `groupId` | string \| null | 같은 값끼리 하나의 그룹 |

## Layer

```json
{ "id": "LYR_BUILDINGS", "name": "Buildings", "visible": true, "locked": false, "opacity": 1 }
```
기본 레이어: `LYR_OCEAN, LYR_TERRAIN, LYR_INFRA, LYR_BUILDINGS, LYR_ENV, LYR_FACILITIES, LYR_INVESTIGATION, LYR_CHARACTERS, LYR_ROUTES`.

## Asset

```json
{
  "id": "AST_OFFICE", "name": "Office Tower", "category": "Buildings",
  "path": "assets/buildings/office.svg", "mime": "image/svg+xml",
  "width": 160, "height": 160,
  "anchor": { "preset": "Center", "x": 0.5, "y": 0.5 },
  "builtin": true
}
```
- `category`: Terrain, Islands, Buildings, Roads, Bridges, Vehicles, Trees, Facilities, Miscellaneous
- `path`: 반드시 `assets/` 로 시작하는 상대 경로, `..` 금지
- `anchor`: 0~1 비율. preset = Center(0.5, 0.5) / Top Left(0, 0) / Bottom Center(0.5, 1) / Custom
- `builtin`: 편집기에 포함된 샘플 에셋 여부. 사용자가 가져온 에셋은 `false` 이고 `assets/<category>/<id>.<ext>` 경로를 씁니다.

## Island

```json
{
  "id": "ISL_0001", "type": "island", "name": "Serim Central", "layer": "LYR_TERRAIN",
  "x": 5200, "y": 5000, "width": 3500, "height": 2700, "rotation": 0,
  "visible": true, "locked": false, "groupId": null,
  "islandType": "Urban",
  "polygon": [ { "x": 6950, "y": 5000 }, { "x": 6900, "y": 5240 } ],
  "texture": "Grass",
  "elevation": 0,
  "coastline": { "type": "Sand", "width": 26, "edgeTypes": [ null, "Seawall" ] },
  "terrain": { "cellSize": 16, "originX": 3424, "originY": 3632, "cols": 224, "rows": 176, "data": "4000*0,12*4,..." }
}
```
- `polygon`: 월드 좌표 꼭짓점, 최소 3개, 닫힌 다각형(마지막 점 = 첫 점 반복 안 함)
- `islandType`: Urban, Residential, Industrial, Military, Rural, Uninhabited, Custom
- `texture`: 섬 기본 지형 = Grass, Sand, Rock, Concrete, Soil, Water
- `coastline.edgeTypes[i]`: `polygon[i] → polygon[i+1]` 가장자리의 해안선 유형, `null` 이면 `coastline.type`. 길이 = 꼭짓점 수. 유형: Sand, Rock, Cliff, Concrete, Harbor, Seawall
- `terrain`: 섬 내부 지형 그리드 또는 `null`(기본 텍스처만)
  - 셀 `(col,row)` 의 월드 영역: `originX + col*cellSize … +cellSize`
  - 셀 값: `0` = 섬 기본 텍스처, `1` Grass, `2` Sand, `3` Rock, `4` Concrete, `5` Soil, `6` Water
  - `data`: 행 우선(row-major) 셀 배열의 RLE, `"개수*값"` 을 쉼표로 연결. 전체 개수 = `cols × rows`
  - 다각형 밖의 셀은 의미 없음(항상 0)

## Road

```json
{
  "id": "RD_0001", "type": "road", "name": "Serim Avenue", "layer": "LYR_INFRA",
  "x": 5225, "y": 4976, "width": 52, "height": 3070.5, "rotation": 0, "visible": true, "locked": false, "groupId": null,
  "roadType": "Main Road",
  "points": [ { "id": "p1", "x": 3700, "y": 5000, "hx": 0, "hy": 0 } ],
  "curve": "Smooth",
  "lanes": 4, "direction": "Two-way", "surface": "Asphalt", "speedLimit": 60,
  "islandId": "ISL_0001",
  "connections": [ { "pointId": "p3", "roadId": "RD_0002", "targetPointId": "q9" } ]
}
```
- `roadType`: Highway, Main Road, Secondary Road, Local Road, Alley, Pedestrian Road, Parking Road
- `points`: 최소 2개. `id` 는 도로 안에서 유일
- `curve`:
  - `Straight` — 점을 직선으로 연결
  - `Smooth` — Catmull-Rom(핸들 자동 계산, `hx/hy` 무시)
  - `Bezier` — 점마다 대칭 핸들 `(hx, hy)` 로 3차 베지어: 구간 i 의 제어점은 `P[i] + h[i]`, `P[i+1] - h[i+1]`
- `width`: 도로 전체 폭(px), `lanes`: 0~16, `direction`: Two-way / One-way(점 순서 방향)
- `surface`: Asphalt, Concrete, Cobblestone, Gravel, Dirt
- `connections`: 이 도로의 점 `pointId` 가 다른 도로 `roadId` 의 점 `targetPointId` 와 같은 교차로라는 뜻. 연결은 한쪽 도로에만 기록되며 양방향으로 해석합니다.

## Bridge

```json
{
  "id": "BR_0001", "type": "bridge", "name": "Haneul Suspension Bridge", "layer": "LYR_INFRA",
  "x": 7240, "y": 4560, "width": 56, "height": 820.4, "rotation": 0, "visible": true, "locked": false, "groupId": null,
  "bridgeType": "Suspension Bridge",
  "startIslandId": "ISL_0001", "endIslandId": "ISL_0002",
  "startPosition": { "x": 6930, "y": 4790 }, "endPosition": { "x": 7590, "y": 4310 },
  "controlPoints": [ { "x": 7250, "y": 4520 } ],
  "lanes": 4,
  "status": "connected"
}
```
- `bridgeType`: Road Bridge, Highway Bridge, Pedestrian Bridge, Railway Bridge, Suspension Bridge, Drawbridge
- 경로: `startPosition → controlPoints… → endPosition` 를 지나는 Catmull-Rom 곡선(제어점이 없으면 직선)
- `status`: 저장 시 계산. 양 끝 섬이 존재하고, 서로 다르고, 각 끝점이 해당 섬 해안선에서 `max(24, width/2)` px 이내면 `connected`, 아니면 `warning`

## Building

```json
{
  "id": "BLD_0001", "type": "building", "name": "Serim City Hall", "layer": "LYR_BUILDINGS",
  "x": 5480, "y": 4700, "width": 180, "height": 140, "rotation": 0, "visible": true, "locked": false, "groupId": null,
  "anchorX": 0.5, "anchorY": 0.5,
  "buildingType": "Government",
  "assetId": "AST_GOVERNMENT",
  "islandId": "ISL_0001",
  "owner": "City of Serim", "address": "1 Serim Avenue", "description": "",
  "investigatable": true,
  "hitbox": { "type": "Rectangle", "points": [ { "x": -90, "y": -70 }, { "x": 90, "y": -70 }, { "x": 90, "y": 70 }, { "x": -90, "y": 70 } ] }
}
```
- `buildingType`: Office, Residential, Commercial, Industrial, Government, Police, Hospital, School, Hotel, Warehouse, Military, Infrastructure, Custom
- 이미지 사각형(로컬): `x ∈ [-anchorX·width, (1-anchorX)·width]`, `y ∈ [-anchorY·height, (1-anchorY)·height]`
- `hitbox.points`: **건물 로컬 좌표**(앵커 기준, 회전 전, 현재 크기 기준 px). 월드 좌표 = `(x, y) + rotate(point, rotation)`
- `hitbox.type`: Rectangle(이미지 사각형), Polygon(자유 다각형), Custom Shape(이미지 불투명 영역 외곽 자동 추출 후 편집 가능)

## Prop (시설물·오브젝트)

```json
{
  "id": "OBJ_0001", "type": "prop", "name": "Pine Tree", "layer": "LYR_ENV",
  "x": 4100, "y": 4300, "width": 48, "height": 48, "rotation": 0, "visible": true, "locked": false, "groupId": null,
  "anchorX": 0.5, "anchorY": 0.5,
  "category": "Trees", "assetId": "AST_PINE", "islandId": "ISL_0001", "description": ""
}
```
`category` 가 Facilities 이면 `facilities` 배열, 그 외는 `objects` 배열에 저장됩니다.

## Area

```json
{
  "id": "AREA_0001", "type": "area", "name": "Crime Scene — Night Alley", "layer": "LYR_INVESTIGATION",
  "x": 6200, "y": 4525, "width": 360, "height": 390, "rotation": 0, "visible": true, "locked": false, "groupId": null,
  "areaType": "Investigation", "polygon": [ { "x": 6020, "y": 4380 } ], "color": "#E8A33D",
  "islandId": "ISL_0001", "description": ""
}
```
`areaType`: Zone, Investigation, Restricted, Spawn, Custom. 추리게임의 사건 현장·출입 제한 구역 등에 씁니다.

## ZIP 패키지

```
SERIM_CITY/
├─ project.world.json
├─ assets/
│  ├─ buildings/office.svg …
│  └─ objects/AST_0001.png …        ← 사용자가 가져온 에셋 (asset.path 그대로)
├─ thumbnails/preview.png           ← 512×512 전체 지도 미리보기
└─ metadata.json                    ← { format, appVersion, projectVersion, projectName, exportedAt, assetFiles, missingAssets, usedAssets, counts }
```

## 버전과 마이그레이션

- `project.version` 이 스키마 버전입니다(현재 `1.0.0`).
- 더 낮은 버전 파일은 `src/data/migrations.js` 의 단계를 차례로 적용해 올립니다(예: `0.9.0 → 1.0.0` 은 facilities/routes/metadata, groupId, coastline.edgeTypes 를 채움).
- 편집기보다 높은 버전의 파일은 열지 않고 오류를 표시합니다.

## 게임에서 읽을 때 체크리스트

1. `project.version` 확인
2. `assets[].path` 를 ZIP 루트 기준으로 이미지 로드
3. Box 객체(building/prop)는 `x, y` 가 앵커 지점임에 주의 — 이미지 왼쪽 위 = `(x - anchorX·width, y - anchorY·height)`(회전 전)
4. 섬·영역·도로·다리 좌표는 이미 월드 좌표 — `rotation` 을 다시 적용하지 않기
5. 클릭 판정은 이미지가 아닌 `hitbox` 사용

## Navigator 경로 내보내기

Navigator ▸ **Route + log JSON** 으로 저장되는 파일입니다(프로젝트 파일과 별개).

```json
{
  "format": "world-builder-route",
  "version": "1.0.0",
  "project": { "id": "PROJECT_001", "name": "SERIM_CITY" },
  "mode": "car",
  "metric": "time",
  "metersPerPixel": 0.5,
  "stops": [
    { "role": "Start", "x": 3720, "y": 5005, "snapped": { "x": 3720.4, "y": 5000.1 } },
    { "role": "Waypoint 1", "x": 5200, "y": 4300, "snapped": { "x": 5200, "y": 4300 } },
    { "role": "Destination", "x": 6300, "y": 8280, "snapped": { "x": 6301.2, "y": 8276.8 } }
  ],
  "route": {
    "distanceM": 3440.2,
    "durationSec": 234.1,
    "points": [ { "x": 3720.4, "y": 5000.1, "t": 0 }, { "x": 3800.2, "y": 4996.3, "t": 2.4 } ],
    "steps": [ { "instruction": "start", "road": "Serim Avenue", "distanceM": 742 }, { "arrive": "Waypoint 1" } ]
  },
  "gps": [ { "t_sec": 0, "clock": "0:00", "x": 3720.4, "y": 5000.1, "speed_kmh": 60, "heading_deg": -3, "road": "Serim Avenue", "event": "start" } ]
}
```
- `route.points[].t`: 출발 후 경과 시간(초). 점 사이는 직선이며 그 구간 도로의 제한속도로 이동합니다.
- `steps[].instruction`: `start`, `continue`, `straight`, `left`, `right`.
- `gps`: 2초(시뮬레이션 시간) 간격 기록 + 이벤트(`start`, `arrived Waypoint N`, `arrived Destination`).
- 좌표는 프로젝트와 같은 월드 좌표(px)입니다. 이 구조는 추후 프로젝트의 `routes` 배열(PHASE 4)에 넣을 수 있게 설계했습니다.
