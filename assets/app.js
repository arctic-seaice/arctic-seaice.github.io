/* 북극 해빙 예보 — 정적 페이지 로직.
   자료는 data/products.js 가 window.PRODUCTS 로 넣어준다(fetch를 쓰지 않으므로 file:// 로
   열어도 지도는 뜬다. 다만 값보기는 캔버스 픽셀을 읽기 때문에 http로 열어야 동작한다).
   두 지도는 하나의 뷰 상태(확대율·이동량)를 공유한다 — 좌 관측 / 우 예보를 같은 자리에서
   비교하는 것이 이 화면의 목적이므로, 따로 움직이면 쓸모가 없다.
   이 파일은 손으로 고쳐도 되며, 갱신 스크립트는 --force-template 없이는 덮어쓰지 않는다. */
(function () {
  const D = window.PRODUCTS;
  const $ = (s) => document.querySelector(s);

  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const k in (attrs || {})) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    }
    kids.flat().forEach((c) => c !== null && c !== undefined && c !== false &&
      e.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c))));
    return e;
  };
  const svgEl = (tag, attrs) => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const ym = (s) => s ? `${s.slice(0, 4)}년 ${+s.slice(5, 7)}월` : '';
  const month_add = (s, k) => {
    const y = +s.slice(0, 4), mo = +s.slice(5, 7) + k;
    return `${y + Math.floor((mo - 1) / 12)}-${String(((mo - 1) % 12 + 12) % 12 + 1).padStart(2, '0')}`;
  };
  const span = (t) => t.length === 1 ? ym(t[0]) : `${ym(t[0])}–${+t[t.length - 1].slice(5, 7)}월`;
  const f2 = (v) => (v === null || v === undefined) ? '—' : v.toFixed(2);

  if (!D || !D.inits || !D.inits.length) {
    $('#maps').appendChild(h('p', {}, '아직 발표된 예보가 없습니다.'));
    return;
  }
  const NX = D.grid.nx, NY = D.grid.ny;
  const MODES = { sic: '해빙 농도', anom: '평년 대비' };
  const st = { init: D.inits[D.inits.length - 1].init, prod: 'P1M', cmap: D.cmaps[0].key,
               mode: 'sic', edges: false };
  const view = { z: 1, fx: 0, fy: 0 };              // 이동량은 뷰 너비/높이에 대한 비율
  const maps = [];                                   // 화면에 떠 있는 지도들 (연동 대상)

  /* ---------------------------------------------------------- 픽셀 읽기(값보기) */
  const PIX = {};
  function pixels(src) {
    if (!src) return Promise.resolve(null);
    if (PIX[src]) return Promise.resolve(PIX[src]);
    return new Promise((res) => {
      const im = new Image();
      im.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = im.naturalWidth; c.height = im.naturalHeight;
          const x = c.getContext('2d', { willReadFrequently: true });
          x.drawImage(im, 0, 0);
          PIX[src] = { w: c.width, d: x.getImageData(0, 0, c.width, c.height).data };
        } catch (err) { PIX[src] = 'blocked'; }     // file:// 에서는 캔버스가 잠긴다
        res(PIX[src]);
      };
      im.onerror = () => { PIX[src] = null; res(null); };
      im.src = src;
    });
  }
  const at = (p, r, c) => (p && p !== 'blocked') ? p.d[((r * p.w) + c) * 4] : null;
  const at16 = (p, r, c) => (p && p !== 'blocked')
    ? ((p.d[((r * p.w) + c) * 4] << 8) | p.d[((r * p.w) + c) * 4 + 1]) : null;
  pixels(D.assets.lat); pixels(D.assets.lon);

  const cur = () => D.inits.find((x) => x.init === st.init) || D.inits[D.inits.length - 1];
  const item = () => (cur().items || {})[st.prod];

  /* ---------------------------------------------------------- 값보기 (두 지도 공통) */
  const readout = () => $('#readout');
  async function readAt(u, v) {
    const P = item();
    if (u < 0 || u >= 1 || v < 0 || v >= 1) { readout().textContent = HINT; return; }
    const col = Math.min(NX - 1, Math.floor(u * NX)), row = Math.min(NY - 1, Math.floor(v * NY));
    const [vf, vo, vc] = await Promise.all([pixels(P.val.fcst), pixels(P.val.obs), pixels(P.val.clim)]);
    if (vf === 'blocked') { readout().textContent = '값보기는 http로 열 때 동작합니다 (file:// 제한)'; return; }
    const la = at16(PIX[D.assets.lat], row, col), lo = at16(PIX[D.assets.lon], row, col);
    const pos = (la === null || lo === null) ? ''
      : `${(la / 100 - 90).toFixed(1)}°N ${(lo / 100 - 180).toFixed(1)}°E`;
    const pc = (x) => (x === null || x === 255) ? '—' : `${Math.round(x / D.legend.val_max * 100)}%`;
    const parts = [pos];
    if (vo) parts.push(`관측 ${pc(at(vo, row, col))}`);
    parts.push(`예보 ${pc(at(vf, row, col))}`);
    if (vc) {
      const c = at(vc, row, col), f = at(vf, row, col);
      const dp = (c === null || c === 255 || f === null || f === 255) ? ''
        : ` (예보 ${(f - c) >= 0 ? '+' : ''}${Math.round((f - c) / D.legend.val_max * 100)}%p)`;
      parts.push(`평년 ${pc(c)}${dp}`);
    }
    readout().textContent = parts.filter(Boolean).join('  ·  ');
  }
  const HINT = '지도 위에 마우스를 올리면 그 격자의 값이 표시됩니다';

  /* ---------------------------------------------------------- 지도 한 장 */
  function makeMap(kind) {
    const field = h('img', { class: 'l field', alt: '' });
    const edge = h('img', { class: 'l edge', alt: '' });
    const land = svgEl('svg', { class: 'l land', viewBox: `0 0 ${NX} ${NY}`, preserveAspectRatio: 'none' });
    land.appendChild(svgEl('path', { d: D.land_fill, fill: D.legend.land, stroke: 'none', 'fill-rule': 'evenodd' }));
    const path = svgEl('path', { d: D.land_coast, fill: 'none', stroke: D.legend.coast,
                                 'stroke-width': 0.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    land.appendChild(path);
    const inner = h('div', { class: 'mapinner' }, field, land, edge);
    const msg = h('div', { class: 'emptymsg' }, '미관측 — 목표월이 아직 관측되지 않았습니다');
    const box = h('div', { class: 'mapview' }, inner, msg,
      h('div', { class: 'zoomctl' },
        h('button', { class: 'zb', type: 'button', title: '확대', onclick: () => zoomAt(1.6, 0.5, 0.5) }, '+'),
        h('button', { class: 'zb', type: 'button', title: '축소', onclick: () => zoomAt(1 / 1.6, 0.5, 0.5) }, '−'),
        h('button', { class: 'zb', type: 'button', title: '처음 위치로', onclick: reset }, '⟲')));
    const m = { kind, box, inner, field, edge, path };
    const ptr = new Map();
    let pinch = 0;

    function apply() {
      view.z = Math.max(1, Math.min(14, view.z));
      view.fx = Math.max(1 - view.z, Math.min(0, view.fx));
      view.fy = Math.max(1 - view.z, Math.min(0, view.fy));
      const W = box.clientWidth, H = box.clientHeight;
      inner.style.transform = `translate(${view.fx * W}px, ${view.fy * H}px) scale(${view.z})`;
      inner.classList.toggle('crisp', view.z >= 3);
      path.setAttribute('stroke-width', Math.max(0.06, 0.5 / view.z));
    }
    m.apply = apply;

    function zoomAt(f, ax, ay) {          // ax, ay = 확대 중심 (뷰 비율)
      const z0 = view.z;
      view.z = Math.max(1, Math.min(14, view.z * f));
      view.fx = ax - (ax - view.fx) * (view.z / z0);
      view.fy = ay - (ay - view.fy) * (view.z / z0);
      maps.forEach((q) => q.apply());
    }
    function reset() { view.z = 1; view.fx = view.fy = 0; maps.forEach((q) => q.apply()); }

    box.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = box.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0016), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    }, { passive: false });
    box.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.zoomctl')) return;     // 포인터를 캡처하면 버튼의 click 이 삼켜진다
      box.setPointerCapture(e.pointerId);
      ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
      box.classList.add('drag');
    });
    box.addEventListener('pointermove', (e) => {
      const r = box.getBoundingClientRect();
      const prev = ptr.get(e.pointerId);
      if (!prev) {
        const u = ((e.clientX - r.left) / r.width - view.fx) / view.z;
        const v = ((e.clientY - r.top) / r.height - view.fy) / view.z;
        readAt(u, v);
        return;
      }
      if (ptr.size === 2) {
        ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...ptr.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) zoomAt(d / pinch, ((a.x + b.x) / 2 - r.left) / r.width, ((a.y + b.y) / 2 - r.top) / r.height);
        pinch = d;
        return;
      }
      view.fx += (e.clientX - prev.x) / r.width;
      view.fy += (e.clientY - prev.y) / r.height;
      ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
      maps.forEach((q) => q.apply());
    });
    const up = (e) => { ptr.delete(e.pointerId); pinch = 0; if (!ptr.size) box.classList.remove('drag'); };
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);
    box.addEventListener('pointerleave', () => { readout().textContent = HINT; });
    box.addEventListener('dblclick', (e) => {
      if (e.target.closest('.zoomctl')) return;
      const r = box.getBoundingClientRect();
      zoomAt(2, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    });

    maps.push(m);
    return m;
  }

  /* ---------------------------------------------------------- 화면 그리기 */
  function panel(kind, title, sub) {
    const m = makeMap(kind);
    const big = h('span', { class: 'big' });
    const unit = h('span', { class: 'unit' }, `×10⁶ km² · 농도 ${Math.round(D.legend.threshold * 100)}% 이상`);
    return {
      map: m, big, unit,
      el: h('figure', { class: 'panel' },
        h('figcaption', {}, h('span', { class: 'ptitle' }, title), h('span', { class: 'psub' }, sub)),
        m.box,
        h('div', { class: 'extent' }, h('span', { class: 'k' }, '해빙면적'), big, unit)),
    };
  }

  function render() {
    const e = cur(), P = item();
    const cmap = st.cmap;
    $('#maps').innerHTML = '';
    maps.length = 0;
    if (!P) { $('#maps').appendChild(h('p', {}, '이 발표 시점에는 해당 예보가 없습니다.')); return; }

    const obsP = panel('obs', '관측', P.img.obs ? span(P.targets) : `${span(P.targets)} · 미관측`);
    const fcstP = panel('fcst', '예보', span(P.targets));
    $('#maps').append(obsP.el, fcstP.el);

    for (const [p, what] of [[obsP, 'obs'], [fcstP, 'fcst']]) {
      const src = P.img[what];
      const layer = src ? (st.mode === 'anom' ? src.anom : src[st.cmap]) : null;
      p.map.box.style.background = st.mode === 'anom'
        ? D.legend.anom.zero : D.cmaps.find((c) => c.key === cmap).ocean;
      if (layer) {
        p.map.field.src = layer;
        p.map.edge.src = src.edge;
        p.map.box.classList.remove('empty');
        p.big.textContent = f2(P.extent[what]);
        p.unit.textContent = `×10⁶ km² · 농도 ${Math.round(D.legend.threshold * 100)}% 이상`
          + (st.mode === 'anom' && P.extent.clim !== undefined
            ? ` · 평년 ${f2(P.extent.clim)} (${P.extent[what] - P.extent.clim >= 0 ? '+' : ''}${(P.extent[what] - P.extent.clim).toFixed(2)})`
            : '');
      } else {
        p.map.box.classList.add('empty');
        p.map.field.removeAttribute('src');
        p.map.edge.removeAttribute('src');
        p.big.textContent = '—';
      }
      p.map.edge.classList.toggle('on', st.edges && !!src);
      p.map.apply();
    }

    $('#initmeta').textContent =
      `${D.products[st.prod].label} · 목표 ${span(P.targets)} · 입력 자료 ${ym(e.input_from)}–${ym(e.init)} ${e.cutoff_day}일까지`;
    readout().textContent = HINT;
    $('#modenote').textContent = st.mode === 'anom'
      ? '파랑은 평년(후행 10년 평균)보다 얼음이 많은 곳, 빨강은 적은 곳입니다. 면적이 평년보다 작아도 빙원 안쪽 농도는 높을 수 있어, 두 수치가 서로 다른 방향을 가리키기도 합니다.'
      : '';

    const s = D.verification[st.prod], own = P.skill;
    $('#skill').innerHTML = '';
    const has = own !== null && own !== undefined;
    $('#skill').append(
      h('span', { class: has ? 'badge' : 'badge muted' },
        has ? `이 예보 · 기후값 대비 ${(own * 100).toFixed(1)}% 우세` : '이 예보 · 아직 검증 전'),
      h('span', { class: 'sk' },
        has ? `${span(P.targets)} 관측과 견준 값입니다. 기후값(후행 10년 평균)보다 그만큼 오차가 작았습니다.`
            : `${span(P.targets)}이 관측되면 여기에 기후값 대비 성적이 표시됩니다.`,
        s && s.n ? ` 이 예보 기간 전체로는 검증된 ${s.n}회 평균 ${(s.skill_vs_clim * 100).toFixed(1)}% 우세입니다.` : ''));

    chartAll();
  }

  /* ---------------------------------------------------------- 조작부 */
  const seg = $('#prodseg');
  Object.entries(D.products).forEach(([k, v]) => seg.appendChild(h('button', {
    class: 'segbtn', type: 'button', 'data-k': k,
    onclick: () => { st.prod = k; syncControls(); render(); },
  }, v.label)));
  const vseg = $('#viewseg');
  Object.entries(MODES).forEach(([k, lab]) => vseg.appendChild(h('button', {
    class: 'segbtn', type: 'button', 'data-k': k,
    onclick: () => { st.mode = k; syncControls(); legend(); render(); },
  }, lab)));
  const sel = $('#initsel');
  D.inits.slice().reverse().forEach((e) => sel.appendChild(h('option', { value: e.init }, ym(e.init))));
  sel.addEventListener('change', () => { st.init = sel.value; syncControls(); render(); });
  const stepInit = (d) => {
    const i = D.inits.findIndex((e) => e.init === st.init) + d;
    if (i < 0 || i >= D.inits.length) return;
    st.init = D.inits[i].init; syncControls(); render();
  };
  $('#initprev').addEventListener('click', () => stepInit(-1));
  $('#initnext').addEventListener('click', () => stepInit(1));
  const csel = $('#cmapsel');
  D.cmaps.forEach((c) => csel.appendChild(h('option', { value: c.key }, c.label)));
  csel.addEventListener('change', () => { st.cmap = csel.value; syncControls(); legend(); render(); });
  $('#edgebtn').addEventListener('click', () => { st.edges = !st.edges; syncControls(); render(); });

  function syncControls() {
    seg.querySelectorAll('.segbtn').forEach((b) => b.classList.toggle('on', b.dataset.k === st.prod));
    vseg.querySelectorAll('.segbtn').forEach((b) => b.classList.toggle('on', b.dataset.k === st.mode));
    csel.disabled = st.mode === 'anom';        // 발산형 색상표는 고정이다
    $('#edgebtn').classList.toggle('on', st.edges);
    sel.value = st.init;
    csel.value = st.cmap;
    const i = D.inits.findIndex((e) => e.init === st.init);
    $('#initprev').disabled = i <= 0;
    $('#initnext').disabled = i < 0 || i >= D.inits.length - 1;
    // 특정 화면을 바로 여는 주소: #2026-08/P1M/Blues_r/anom
    history.replaceState(null, '', `#${st.init}/${st.prod}/${st.cmap}/${st.mode}`);
  }

  function readHash() {
    const p = (location.hash || '').replace(/^#/, '').split('/');
    if (D.inits.some((e) => e.init === p[0])) st.init = p[0];
    if (D.products[p[1]]) st.prod = p[1];
    if (D.cmaps.some((c) => c.key === p[2])) st.cmap = p[2];
    if (MODES[p[3]]) st.mode = p[3];
  }
  window.addEventListener('hashchange', () => { readHash(); syncControls(); legend(); render(); });

  function legend() {
    const c = D.cmaps.find((x) => x.key === st.cmap);
    const A = D.legend.anom, an = st.mode === 'anom';
    const sw = (color, label) => h('div', { class: 'sw' },
      h('span', { class: 'chip', style: `background:${color}` }), label);
    $('#legendrow').innerHTML = '';
    $('#legendrow').append(
      h('div', { class: 'legend' },
        h('div', { class: 'cap' }, an ? '평년 대비 (후행 10년 평균과의 차이)' : '해빙 농도'),
        h('div', { class: 'bar', style: `background:linear-gradient(90deg, ${(an ? A.swatches : c.swatches).join(', ')})` }),
        h('div', { class: 'ends' },
          h('span', {}, an ? `적음 −${Math.round(A.range * 100)}%p` : '0%'),
          h('span', {}, an ? `많음 +${Math.round(A.range * 100)}%p` : '100%'))),
      h('div', { class: 'legend' },
        h('div', { class: 'cap' }, '그 밖'),
        h('div', { class: 'swrow' },
          sw(D.legend.edge_fcst, `예보 ${Math.round(D.legend.threshold * 100)}% 경계`),
          sw(D.legend.edge_obs, '관측 경계'),
          sw(D.legend.land, '육지'))));
  }

  /* ---------------------------------------------------------- 해빙면적 그래프 */
  function chartAll() {
    const host = $('#sie');
    const S = (D.sie || {})[st.prod];
    host.innerHTML = '';
    $('#chartlegend').innerHTML = '';
    if (!S || !S.obs.length) return;
    const k = D.products[st.prod].months;
    $('#chartsub').textContent = k === 1
      ? '월평균 해빙농도에서 농도 15% 이상 격자를 세어 계산한 면적입니다. 선은 관측, 점은 각 초기화의 예보입니다.'
      : '3개월 평균 해빙농도에서 계산한 면적입니다. 가로축은 3개월 구간의 첫 달이고, 선은 관측, 점은 각 초기화의 예보입니다.';

    const W = Math.max(320, host.clientWidth), H = 320, m = { l: 58, r: 14, t: 14, b: 40 };
    const months = [...new Set([...S.obs.map((d) => d[0]), ...S.fcst.map((d) => d[0])])].sort();
    const idx = new Map(months.map((v, i) => [v, i]));
    const X = (i) => m.l + (W - m.l - m.r) * (months.length < 2 ? 0.5 : i / (months.length - 1));
    const vals = [...S.obs, ...S.fcst].map((d) => d[1]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.12 || 1;
    lo = Math.max(0, lo - pad); hi += pad;
    const Y = (v) => m.t + (H - m.t - m.b) * (1 - (v - lo) / (hi - lo));
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img',
                               'aria-label': '해빙면적 관측과 예보 시계열' });
    const add = (tag, at, text) => {
      const e = svgEl(tag, at);
      if (text !== undefined) e.textContent = text;
      svg.appendChild(e);
      return e;
    };
    const step = Math.max(0.5, Math.round((hi - lo) / 4 * 2) / 2);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      add('line', { x1: m.l, x2: W - m.r, y1: Y(v).toFixed(1), y2: Y(v).toFixed(1), stroke: '#dfe8f0' });
      add('text', { x: m.l - 10, y: (Y(v) + 5).toFixed(1), 'text-anchor': 'end', class: 'ax' }, v.toFixed(1));
    }
    add('text', { x: m.l - 10, y: m.t - 2, 'text-anchor': 'end', class: 'ax' }, '×10⁶ km²');
    const every = Math.max(1, Math.round(months.length / 8));
    months.forEach((mm, i) => {
      if (i % every && i !== months.length - 1) return;
      add('text', { x: X(i).toFixed(1), y: H - 14, 'text-anchor': 'middle', class: 'ax' },
          `${mm.slice(2, 4)}.${mm.slice(5, 7)}`);
    });
    add('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: '#c3d5e4' });

    const guide = add('line', { y1: m.t, y2: H - m.b, stroke: '#6b8296', 'stroke-width': 1,
                                'stroke-dasharray': '3 3', opacity: 0 });
    const obsPts = S.obs.map((d) => [X(idx.get(d[0])), Y(d[1])]);
    add('path', { d: 'M' + obsPts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L'),
                  fill: 'none', stroke: '#004d82', 'stroke-width': 2.2, 'stroke-linejoin': 'round' });
    S.obs.forEach((d) => add('circle', { cx: X(idx.get(d[0])).toFixed(1), cy: Y(d[1]).toFixed(1),
                                         r: 3, fill: '#004d82' }));
    if (S.fcst.length) {
      const fp = S.fcst.map((d) => [X(idx.get(d[0])), Y(d[1])]);
      add('path', { d: 'M' + fp.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L'),
                    fill: 'none', stroke: '#ff6a13', 'stroke-width': 1.6, 'stroke-dasharray': '5 4' });
      S.fcst.forEach((d, i) => {
        const sel = d[0] === (item() ? item().targets[0] : null);
        add('circle', { cx: fp[i][0].toFixed(1), cy: fp[i][1].toFixed(1), r: sel ? 7 : 4.5,
                        fill: sel ? '#ff6a13' : '#fff', stroke: '#ff6a13', 'stroke-width': 2 });
      });
    }
    host.appendChild(svg);

    const tip = h('div', { class: 'tip' });
    host.appendChild(tip);
    const O = new Map(S.obs), F = new Map(S.fcst);
    const hit = add('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' });
    const hide = () => { tip.classList.remove('on'); guide.setAttribute('opacity', 0); };
    hit.addEventListener('mouseleave', hide);
    hit.addEventListener('mousemove', (ev) => {
      const r = svg.getBoundingClientRect();
      const px = (ev.clientX - r.left) * (W / r.width);
      let i = Math.round((px - m.l) / ((W - m.l - m.r) / Math.max(1, months.length - 1)));
      i = Math.max(0, Math.min(months.length - 1, i));
      const mm = months[i], o = O.get(mm), f = F.get(mm);
      if (o === undefined && f === undefined) { hide(); return; }
      guide.setAttribute('x1', X(i)); guide.setAttribute('x2', X(i)); guide.setAttribute('opacity', 1);
      const per = D.products[st.prod].months === 1 ? ym(mm) : `${ym(mm)}–${+month_add(mm, 2).slice(5, 7)}월`;
      tip.innerHTML = `<b>${per}</b>` +
        (o === undefined ? '' : `<span><i class="d o"></i>관측 ${o.toFixed(2)}</span>`) +
        (f === undefined ? '' : `<span><i class="d f"></i>예보 ${f.toFixed(2)}</span>`) +
        (o === undefined || f === undefined ? ''
          : `<span class="df">차이 ${(f - o >= 0 ? '+' : '') + (f - o).toFixed(2)}</span>`);
      const left = Math.min(Math.max(0, (X(i) / W) * r.width - 70), r.width - 150);
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(0, (Math.min(o === undefined ? 1e9 : Y(o), f === undefined ? 1e9 : Y(f)) / H) * r.height - 88)}px`;
      tip.classList.add('on');
    });
    const key = (color, label, dash) => h('span', { class: 'ck' },
      h('span', { class: 'line', style: `background:${dash ? 'none' : color};` +
        (dash ? `border-top:2px dashed ${color};` : '') }), label);
    $('#chartlegend').append(key('#004d82', '관측'), key('#ff6a13', '예보 (각 초기화)', true),
      h('span', { class: 'ck note' }, '점 위에 마우스를 올리면 값이 표시됩니다'));
  }

  window.addEventListener('resize', () => { maps.forEach((m) => m.apply()); chartAll(); });
  readHash(); syncControls(); legend(); render();
  $('#genstamp').textContent =
    `예보 갱신 ${D.generated_utc.slice(0, 10)} · 관측 자료 ${ym(D.observations_through)}까지`;
  $('#yr').textContent = new Date().getFullYear();
})();
