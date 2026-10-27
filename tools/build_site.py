#!/usr/bin/env python3
"""북극 해빙 예측 nc → arctic-seaice.github.io 변환기.

sea-ice-forecasting 폴더에 PKNU_AI_SIC_YYYYMM.nc 를 넣고 이 스크립트를 한 번 돌리면
  1) 발표마다 4패널 그림(다음 3개월 + 3개월 평균)을 figs/SIC_YYYYMM.png 로 만들고
  2) nc 와 reference_sie.csv 를 files/ 로 복사하고
  3) index.html(최신 그림 + 첨부파일 + 지난 발표 목록)과 sitemap.xml 을 다시 쓴다.

이미 만든 그림은 nc 가 바뀌지 않았으면 건너뛴다(--force 로 전부 다시).

사용법 (사이트 저장소 폴더에서):
    python3 tools/build_site.py                       # 기본: ../sea-ice-forecasting
    python3 tools/build_site.py --src /경로/sea-ice-forecasting
필요 패키지: numpy, xarray, netCDF4, matplotlib, pillow
"""
from __future__ import annotations

import argparse
import csv
import html
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import xarray as xr
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap, BoundaryNorm, ListedColormap
from matplotlib.lines import Line2D
from PIL import Image

SITE = Path(__file__).resolve().parent.parent
TOOLS = SITE / "tools"
FIGS = SITE / "figs"
FILES = SITE / "files"
URL = "https://arctic-seaice.github.io/"
NC_RE = re.compile(r"PKNU_AI_SIC_(\d{4})(\d{2})\.nc$")

CELL_KM2 = 25.0 * 25.0
THRESH = 0.15
OCEAN, LAND, EDGE = "#0c2340", "#8e9ea9", "#c8372d"

from matplotlib import font_manager as _fm

_have = {f.name for f in _fm.fontManager.ttflist}
_kor = next((n for n in ("Apple SD Gothic Neo", "AppleGothic", "Malgun Gothic", "NanumGothic",
                         "Noto Sans CJK KR", "Noto Sans KR") if n in _have), None)
plt.rcParams["font.family"] = [_kor, "DejaVu Sans"] if _kor else ["DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False


# ---------------------------------------------------------------- 자료 읽기
def ym_label(y: int, m: int) -> str:
    return f"{y}년 {m}월"


def add_month(y: int, m: int, k: int) -> tuple[int, int]:
    t = y * 12 + (m - 1) + k
    return t // 12, t % 12 + 1


def read_reference(src: Path) -> dict:
    """reference_sie.csv → {'2026-11': {'obs': float|None, 'clim10': float}}"""
    ref = {}
    p = src / "reference_sie.csv"
    if p.exists():
        with p.open(encoding="utf-8") as f:
            for r in csv.DictReader(f):
                ref[r["target"]] = {
                    "obs": float(r["obs"]) if r.get("obs") else None,
                    "clim10": float(r["clim10"]) if r.get("clim10") else None,
                }
    return ref


def north_up(a: np.ndarray, y: np.ndarray) -> np.ndarray:
    """y 가 남→북으로 증가하면 위아래를 뒤집어 북쪽이 위로 오게 한다."""
    return a[..., ::-1, :] if y[0] < y[-1] else a


def sie(field: np.ndarray) -> float:
    return float((np.nan_to_num(field) >= THRESH).sum() * CELL_KM2 / 1e6)


def load(nc: Path) -> dict:
    with xr.open_dataset(nc) as ds:
        y = ds["y"].values
        sic = north_up(ds["sic"].values.astype("float32"), y)
        sic3 = north_up(ds["sic_3month"].values.astype("float32"), y)
        attrs = dict(ds.attrs)
    oy, om = int(nc.stem[-6:-2]), int(nc.stem[-2:])
    cutoff = str(attrs.get("sic_cutoff_days", "1~15")).split("~")[-1].strip() or "15"
    hist = str(attrs.get("history", ""))[:10]
    targets = [add_month(oy, om, k) for k in (1, 2, 3)]
    return dict(origin=(oy, om), cutoff=cutoff, produced=hist, sic=sic, sic3=sic3,
                targets=targets, model=attrs.get("model_version", ""),
                sie=[sie(sic[i]) for i in range(3)], sie3=sie(sic3))


def write_text(path: Path, text: str) -> None:
    if path.exists():
        if path.read_text(encoding="utf-8") == text:
            return
        path.unlink()
    path.write_text(text, encoding="utf-8")


def copy_if_changed(src: Path, dst: Path) -> None:
    """내용이 다를 때만 복사한다 (구글 드라이브 폴더에서도 덮어쓰기가 안전하도록 지우고 새로 쓴다)."""
    if dst.exists():
        if dst.read_bytes() == src.read_bytes():
            return
        dst.unlink()
    shutil.copyfile(src, dst)


# ---------------------------------------------------------------- 그림
def make_cmap():
    blues = LinearSegmentedColormap.from_list(
        "ice", ["#1f5a96", "#3c86c0", "#7db6dd", "#c5e0f2", "#ffffff"])
    n = 256
    cols = [OCEAN] * int(n * THRESH) + [blues(i / (n - int(n * THRESH) - 1))
                                        for i in range(n - int(n * THRESH))]
    return ListedColormap(cols)


def draw(info: dict, land: np.ndarray, ref: dict, out: Path) -> None:
    cmap = make_cmap()
    oy, om = info["origin"]
    fig, axes = plt.subplots(1, 4, figsize=(20, 7.6))
    fig.subplots_adjust(left=0.01, right=0.90, top=0.80, bottom=0.03, wspace=0.12)
    fields = [info["sic"][i] for i in range(3)] + [info["sic3"]]
    names = [ym_label(*t) for t in info["targets"]]
    t0, t2 = info["targets"][0], info["targets"][2]
    names.append(f"{t0[1]}~{t2[1]}월 평균")
    sies = info["sie"] + [info["sie3"]]
    keys = [f"{y}-{m:02d}" for y, m in info["targets"]] + [None]

    for ax, f, nm, s, k in zip(axes, fields, names, sies, keys):
        rgb = np.where(np.isnan(f), 0.0, f)
        ax.imshow(rgb, cmap=cmap, vmin=0, vmax=1, interpolation="nearest")
        ax.imshow(np.ma.masked_where(~land, land), cmap=ListedColormap([LAND]),
                  interpolation="nearest")
        ax.contour(np.where(land, np.nan, rgb), levels=[THRESH], colors=EDGE, linewidths=1.6)
        sub = f"SIE {s:.2f} M km²"
        r = ref.get(k) if k else None
        if r and r.get("obs") is not None:
            sub += f"  (관측 {r['obs']:.2f})"
        elif r and r.get("clim10") is not None:
            sub += f"  (평년 {r['clim10']:.2f})"
        ax.set_title(f"{nm}\n{sub}", fontsize=17, linespacing=1.4)
        ax.set_xticks([]); ax.set_yticks([])
        for sp in ax.spines.values():
            sp.set_color("#b8c4cc")

    axes[0].legend(handles=[Line2D([], [], color=EDGE, lw=2, label="예측 빙연 (15%)")],
                   loc="lower left", fontsize=13, framealpha=0.92)
    cax = fig.add_axes([0.915, 0.06, 0.013, 0.70])
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=plt.Normalize(0, 1))
    cb = fig.colorbar(sm, cax=cax, ticks=[0, .15, .3, .5, .7, .9, 1])
    cb.ax.set_yticklabels(["0", "15%", "30%", "50%", "70%", "90%", "100%"], fontsize=13)
    cb.set_label("해빙 점유율", fontsize=15)
    fig.suptitle(f"북극 해빙 점유율(SIC) 예측 — {oy}년 {om}월 {info['cutoff']}일 초기화",
                 fontsize=22, y=0.975)
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, dpi=110, facecolor="white")
    plt.close(fig)


# ---------------------------------------------------------------- 페이지
def esc(s) -> str:
    return html.escape(str(s))


def page(items: list[dict], ref_csv: bool) -> str:
    tpl = (TOOLS / "template.html").read_text(encoding="utf-8")
    latest = items[0]
    oy, om = latest["origin"]
    t = latest["targets"]
    stamp = f"?v={latest['mtime']}"

    rows = []
    for i, it in enumerate(items):
        y, m = it["origin"]
        tg = ", ".join(f"{a}.{b:02d}" for a, b in it["targets"])
        sv = " · ".join(f"{v:.2f}" for v in it["sie"])
        rows.append(
            f'<tr><td class="o">{y}년 {m}월{" <em>최신</em>" if i == 0 else ""}</td>'
            f'<td>{tg}</td><td class="n">{sv}</td>'
            f'<td class="dl"><a href="figs/{it["fig"]}{it["v"]}" target="_blank">그림</a>'
            f'<a href="files/{it["nc"]}" download>NetCDF</a></td></tr>')

    dist = ",\n        ".join(
        '{ "@type": "DataDownload", "encodingFormat": "application/x-netcdf", '
        f'"contentUrl": "{URL}files/{it["nc"]}", "name": "{it["origin"][0]}년 {it["origin"][1]}월 발표" }}'
        for it in items)

    sub = (f"{oy}년 {om}월 {latest['cutoff']}일까지의 자료로 산출한 "
           f"{t[0][0]}년 {t[0][1]}월 ~ {t[2][0]}년 {t[2][1]}월 예측")
    rep = {
        "{{LATEST_FIG}}": f"figs/{latest['fig']}{stamp}",
        "{{LATEST_NC}}": f"files/{latest['nc']}",
        "{{LATEST_NC_NAME}}": latest["nc"],
        "{{LATEST_TITLE}}": f"{oy}년 {om}월 발표",
        "{{LATEST_SUB}}": esc(sub),
        "{{LATEST_PRODUCED}}": esc(latest["produced"] or ""),
        "{{LATEST_MODEL}}": esc(latest["model"]),
        "{{REF_LINK}}": ('<a class="btn ghost" href="files/reference_sie.csv" download>'
                         '참고 해빙면적 (CSV)</a>' if ref_csv else ""),
        "{{ROWS}}": "\n        ".join(rows),
        "{{DISTRIBUTION}}": dist,
        "{{UPDATED}}": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "{{YEAR}}": str(datetime.now().year),
    }
    for k, v in rep.items():
        tpl = tpl.replace(k, v)
    return tpl


def sitemap(day: str) -> str:
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            f'  <url>\n    <loc>{URL}</loc>\n    <lastmod>{day}</lastmod>\n'
            '    <changefreq>monthly</changefreq>\n  </url>\n</urlset>\n')


# ---------------------------------------------------------------- 실행
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", type=Path, default=SITE.parent / "sea-ice-forecasting",
                    help="예측 nc 가 들어 있는 폴더 (기본: 사이트 옆 sea-ice-forecasting)")
    ap.add_argument("--force", action="store_true", help="그림을 모두 다시 그린다")
    a = ap.parse_args()

    ncs = sorted((p for p in a.src.glob("PKNU_AI_SIC_*.nc") if NC_RE.search(p.name)), reverse=True)
    if not ncs:
        raise SystemExit(f"nc 파일이 없습니다: {a.src}")
    land = np.array(Image.open(TOOLS / "land_mask.png")) > 0
    ref = read_reference(a.src)
    FIGS.mkdir(exist_ok=True); FILES.mkdir(exist_ok=True)

    items = []
    for nc in ncs:
        ym = nc.stem[-6:]
        fig = FIGS / f"SIC_{ym}.png"
        dst = FILES / nc.name
        info = load(nc)
        changed = (not dst.exists() or dst.stat().st_size != nc.stat().st_size
                   or dst.stat().st_mtime < nc.stat().st_mtime)
        if a.force or changed or not fig.exists():
            draw(info, land, ref, fig)
            copy_if_changed(nc, dst)
            print(f"  그림  {fig.relative_to(SITE)}")
        mt = int(nc.stat().st_mtime)
        info.update(fig=fig.name, nc=nc.name, mtime=mt, v=f"?v={mt}")
        info.pop("sic"); info.pop("sic3")
        items.append(info)

    # 원본 폴더에서 사라진 발표는 사이트에서도 지운다
    keep = {it["nc"] for it in items}
    for p in FILES.glob("PKNU_AI_SIC_*.nc"):
        if p.name not in keep:
            p.unlink(); (FIGS / f"SIC_{p.stem[-6:]}.png").unlink(missing_ok=True)
            print(f"  삭제  {p.name}")

    ref_csv = (a.src / "reference_sie.csv").exists()
    if ref_csv:
        copy_if_changed(a.src / "reference_sie.csv", FILES / "reference_sie.csv")

    write_text(SITE / "index.html", page(items, ref_csv))
    write_text(SITE / "sitemap.xml", sitemap(datetime.now(timezone.utc).strftime("%Y-%m-%d")))
    oy, om = items[0]["origin"]
    print(f"완료 — 발표 {len(items)}건, 최신 {oy}-{om:02d}. 이제 git add -A && git commit && git push")


if __name__ == "__main__":
    main()
