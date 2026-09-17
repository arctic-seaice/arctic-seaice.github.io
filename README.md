# 북극 해빙 예보 — arctic-seaice.github.io

다음 달(P-1M)과 다음 3개월(P-3M)의 북극 해빙 농도를 매달 예측해 공개하는 정적 사이트다.
국립부경대학교 지능형 공간데이터과학 연구실(iGDSL, https://igdsl.github.io/).

- 격자: NSIDC 극사영 북반구 25 km (EPSG:3411, 304×448)
- 입력: NOAA/NSIDC CDR G02202 v6(해빙 농도) + ECMWF ERA5(대기). 직전 12개월이며 마지막 달은 1–15일 부분 관측
- 방법: CMIP6 사전학습 파운데이션 모델 앙상블 + 종단간 영상예측 모델 + 후행 10년 기후값의 결합.
  결합 가중치는 검증기간(2016–2020)에서만 정하고 시험기간에는 손대지 않았다
- 연구 산출물이며, 안전이 걸린 판단의 근거로 쓰도록 만든 공식 예보가 아니다

## 이 저장소의 내용

| 경로 | 무엇 |
|---|---|
| `index.html`, `assets/` | 페이지 — **손으로 고치는 절반** |
| `img/`, `val/`, `data/products.js` | 매달 자동 생성 — 직접 고치지 말 것 |

생성기는 예보 시스템 저장소의 `scripts/utils/export_products_site.py`이고, 매달 예보가 산출된 뒤
그곳에서 실행해 이 저장소로 push한다. 생성기는 자기가 만들지 않은 `img/`·`val/` 파일을 지우므로,
그 두 폴더에 손으로 파일을 두지 않는다. 페이지(`index.html`, `assets/`)를 고치면
생성기 쪽 템플릿(`webapp/site_template/`)에도 같이 반영해야 다음 달에 되돌아가지 않는다.

자료 출처: NOAA/NSIDC Sea Ice Concentration CDR (G02202 v6), ECMWF ERA5 (Copernicus Climate Change Service).
