# 북극 해빙 예보 — arctic-seaice.github.io

다음 3개월의 북극 해빙 농도를 매달 예측해 **발표별 지도 그림(넘겨 보기) + 해빙면적 예측 vs 관측 그래프**로 공개하는 정적 사이트다.
국립부경대학교 지능형 공간데이터과학 연구실(iGDSL, https://igdsl.github.io/).
연구 산출물이며, 안전이 걸린 판단의 근거로 쓰도록 만든 공식 예보가 아니다.

## 매달 올리는 법

1. 예측 결과 `PKNU_AI_SIC_YYYYMM.nc`(와 갱신된 `reference_sie.csv`)를 옆 폴더 `../sea-ice-forecasting/` 에 넣는다.
2. 이 폴더에서 변환기를 돌린다.
   ```bash
   python3 tools/build_site.py          # 원본 폴더가 다른 곳이면 --src 경로
   ```
3. `git add -A && git commit -m "2026년 11월 발표" && git push`

변환기는 새로 들어오거나 바뀐 nc 만 그림을 다시 그리고(`--force` 로 전부), `index.html`·`sitemap.xml` 을 다시 쓴다.
원본 폴더에서 nc 를 지우면 사이트에서도 그 발표가 빠진다. nc 파일 자체는 사이트에 올리지 않는다(내려받기 없음).
해빙면적 그래프의 관측·평년값은 `reference_sie.csv` 에서 읽으므로, 관측이 나오면 그 파일의 `obs` 를 채워 둔다.
필요 패키지: `pip install numpy xarray netCDF4 matplotlib pillow`

## 이 저장소의 내용

| 경로 | 무엇 |
|---|---|
| `tools/build_site.py` | 변환기 (nc → 그림·페이지) |
| `tools/template.html` | 페이지 틀 — **페이지를 고치려면 여기를 고친다** (`index.html` 은 매번 덮어씀) |
| `tools/land_mask.png` | 25 km 격자(304×448, 북쪽 위) 육지 마스크 |
| `assets/` | 스타일·파비콘·공유카드 — 손으로 고친다 |
| `figs/SIC_YYYYMM.png` | 발표별 4패널 그림 — 자동 생성 |
| `index.html`, `sitemap.xml` | 자동 생성 (발표 목록·해빙면적 값이 JSON 으로 들어 있다) |

그림: 다음 3개월 각각과 3개월 평균의 해빙 농도, 빨간 선은 예측 해빙경계(15%).
패널 제목의 SIE 는 15% 이상 격자 면적(25 km × 25 km 격자 수)이고, 괄호는 `reference_sie.csv` 의 관측값(있으면) 또는 10년 평년값이다.

## 검색 노출

`tools/template.html` 의 `<head>` 에 canonical·OG·트위터 카드와 schema.org `Dataset` 구조화 데이터가 있다. 검색엔진 소유확인 코드는 템플릿 `<head>` 의 주석 자리에 붙인다.

자료 출처: NOAA/NSIDC Sea Ice Concentration CDR (G02202 v6), ECMWF ERA5 (Copernicus Climate Change Service).
