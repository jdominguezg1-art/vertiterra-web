/* Verti Terra: page logic.
   - one WhatsApp number constant (below), every link is built from it
   - listings come from data/apartamentos.json (add apartments there, not here)
   - the budget line (the page's signature): one budget value shared by the
     pinned line, the catalogue filter, the dossier and the visit form
   - hero planes driven from scroll, page-local (the engine is untouched)
   - ES/EN toggle, hash-routed dossiers (#/apto/<id>), WhatsApp-composed forms
   Nothing here sends anything: every form only builds a wa.me link that the
   visitor opens and sends from their own WhatsApp. */
(function () {
  'use strict';

  // The one place the phone number lives. Source: anuncios/*.txt
  // ("Teléfono de contacto: 7279-8418 (llamadas y WhatsApp)").
  var WA_NUMBER = '50672798418';
  var WA_DISPLAY = '+506 7279-8418';

  var B_MIN = 100000, B_MAX = 600000;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  var EN = window.VT_I18N.en, DYN = window.VT_I18N.dyn;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (x, a, b) { return x < a ? a : x > b ? b : x; };
  var smooth = function (x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  var store = {
    get: function (k) { try { return localStorage.getItem('vt.' + k); } catch (e) { return null; } },
    set: function (k, v) { try { if (v == null) localStorage.removeItem('vt.' + k); else localStorage.setItem('vt.' + k, String(v)); } catch (e) {} }
  };

  var state = {
    lang: store.get('lang') === 'en' ? 'en' : 'es',
    budget: null,          // null = sin límite
    budgetUser: false,     // the visitor has moved a line
    pago: null,
    data: null,
    f: { zona: '', condo: '', piso: '', hab: 0, sort: 'asc' },
    visitApt: '',
    step: 1,
    sent: { visit: false, owner: false }   // the visitor opened WhatsApp from that form
  };
  (function restore() {
    var b = parseInt(store.get('budget'), 10);
    if (b >= B_MIN && b < B_MAX) { state.budget = b; state.budgetUser = true; }
    var p = store.get('pago');
    if (p === 'contado' || p === 'credito' || p === 'nose') state.pago = p;
  })();

  function T(key, vars) {
    var s = DYN[state.lang][key];
    if (s == null) s = DYN.es[key];
    if (vars) Object.keys(vars).forEach(function (k) { s = String(s).split('{' + k + '}').join(vars[k]); });
    return s;
  }
  function L(obj) { return obj == null ? '' : (typeof obj === 'string' ? obj : (obj[state.lang] != null ? obj[state.lang] : obj.es)); }
  function money(n) { return 'US$' + Number(n).toLocaleString('en-US'); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // Placeholders like [FALTA: ...] are shown on purpose, highlighted.
  function txt(s) { return esc(s).replace(/\[(FALTA|MISSING)[^\]]*\]/g, function (m) { return '<mark class="missing">' + m + '</mark>'; }); }
  function waLink(msg) { return 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(msg); }
  function budgetText(b) { return b == null ? T('noLimit') : money(b); }

  /* ------------------------------------------------------------ i18n -- */
  function captureSpanish() {
    $$('[data-i18n]').forEach(function (el) { el.__es = el.innerHTML; });
    $$('[data-i18n-attr]').forEach(function (el) {
      el.__esAttr = {};
      el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        var a = pair.split(':')[0].trim();
        el.__esAttr[a] = el.getAttribute(a);
      });
    });
  }
  function applyLang() {
    var en = state.lang === 'en';
    document.documentElement.lang = state.lang;
    $$('[data-i18n]').forEach(function (el) {
      var k = el.getAttribute('data-i18n');
      el.innerHTML = en && EN[k] != null ? EN[k] : el.__es;
    });
    $$('[data-i18n-attr]').forEach(function (el) {
      el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        var parts = pair.split(':'), a = parts[0].trim(), k = parts[1].trim();
        el.setAttribute(a, en && EN[k] != null ? EN[k] : el.__esAttr[a]);
      });
    });
    document.title = T('title');
    var md = $('meta[name="description"]'); if (md) md.setAttribute('content', T('desc'));
    var mt = $('#menuToggle'); if (mt) mt.setAttribute('aria-label', T(mt.getAttribute('aria-expanded') === 'true' ? 'menuClose' : 'menuOpen'));
    store.set('lang', state.lang);
  }

  /* ------------------------------------------------------- whatsapp -- */
  function msgFor(kind) {
    if (kind === 'search') {
      var f = state.f, lines = [T('msgSearch')];
      if (f.zona) lines.push((state.lang === 'en' ? 'Area' : 'Zona') + ': ' + f.zona);
      if (f.condo) lines.push((state.lang === 'en' ? 'Condominium' : 'Condominio') + ': ' + f.condo);
      if (f.piso) { var tx = state.data.taxonomia.pisoTipo.filter(function (t) { return t.id === f.piso; })[0]; if (tx) lines.push((state.lang === 'en' ? 'Floor or type' : 'Piso o tipo') + ': ' + L(tx)); }
      if (f.hab) lines.push((state.lang === 'en' ? 'Bedrooms' : 'Habitaciones') + ': ' + f.hab + '+');
      lines.push(T('msgBudget') + ': ' + (state.budget == null ? T('noLimit') : T('upTo', { v: money(state.budget) })));
      return lines.join('\n');
    }
    if (kind === 'owner') return ownerMsg();
    if (kind === 'visit') return visitMsg();
    return T('msgGeneral');
  }
  function refreshWa() {
    $$('.js-wa').forEach(function (a) {
      var kind = a.getAttribute('data-wa');
      if (!kind || !state.data && kind !== 'general') return;
      a.href = waLink(msgFor(kind));
    });
    $$('.js-wa-num').forEach(function (s) { s.textContent = WA_DISPLAY; });
  }

  /* --------------------------------------------------- budget state -- */
  var earthInputs = [];   // { input, svg, path, out, offset }
  function earthPath(W, X, T) {
    // The logo's earth line: a hairline that swells to a rounded end.
    X = Math.max(X, 0.5);
    var cy = 20, n = 24, top = [], bot = [];
    for (var i = 0; i <= n; i++) {
      var x = X * i / n, t = 1.2 + (T - 1.2) * Math.pow(i / n, 1.7);
      top.push(x.toFixed(1) + ' ' + (cy - t / 2).toFixed(2));
      bot.unshift(x.toFixed(1) + ' ' + (cy + t / 2).toFixed(2));
    }
    var r = T / 2;
    return 'M' + top.join(' L') + ' A' + r + ' ' + r + ' 0 0 1 ' + bot[0] + ' L' + bot.join(' L') + ' Z';
  }
  function drawEarth(E, value) {
    var W = E.svg.getBoundingClientRect().width || 1;
    E.svg.setAttribute('viewBox', '0 0 ' + W.toFixed(1) + ' 40');
    var frac = (clamp(value, B_MIN, B_MAX) - B_MIN) / (B_MAX - B_MIN);
    var x = E.offset + frac * (W - 2 * E.offset);
    E.path.setAttribute('d', earthPath(W, x, E.thick));
    var rail = E.svg.querySelector('line'); if (rail) rail.setAttribute('x2', W.toFixed(1));
  }
  function registerEarth(input, svg, out, offset, thick) {
    var E = { input: input, svg: svg, path: svg.querySelector('.line__fill'), out: out, offset: offset, thick: thick };
    earthInputs.push(E);
    input.addEventListener('input', function () {
      var v = parseInt(input.value, 10);
      setBudget(v >= B_MAX ? null : v, true, input);
    });
    return E;
  }
  function setBudget(b, user, source) {
    state.budget = b;
    if (user) state.budgetUser = true;
    store.set('budget', b == null ? null : b);
    syncBudgetUI(source);
    renderLedger();
    refreshPins();
    refreshVisit();
  }
  function syncBudgetUI(source) {
    var v = state.budget == null ? B_MAX : state.budget;
    earthInputs.forEach(function (E) {
      if (E.input === lineEl.input && !state.budgetUser) return; // the demo owns the big line until touched
      if (E.input !== source) E.input.value = v;
      E.input.setAttribute('aria-valuetext', budgetText(state.budget));
      if (E.out) E.out.textContent = budgetText(state.budget);
      drawEarth(E, v);
    });
    // While the demo owns the big line, lineFrame() only writes #lineOut on a
    // value change, so a language switch must rewrite it here.
    if (lineEl.out && !state.budgetUser) {
      lineEl.out.textContent = demoV >= B_MAX ? T('noLimit') : money(demoV);
      lineEl.input.setAttribute('aria-valuetext', demoV >= B_MAX ? T('noLimit') : money(demoV));
    }
    var chip = $('#budgetChip');
    if (state.budgetUser && state.budget != null) { chip.hidden = false; chip.textContent = T('upTo', { v: money(state.budget) }); }
    else chip.hidden = true;
    if (state.budgetUser) $('#lineAfter').classList.remove('is-waiting');
  }

  /* ------------------------------------------------ the line (peak) -- */
  var lineEl = {};
  function buildLine() {
    var sec = $('#presupuesto');
    lineEl = { sec: sec, stage: $('#lineStage'), plot: $('#linePlot'), pins: $('#linePins'), input: $('#lineInput'), out: $('#lineOut'), axis: $('#lineAxis'),
               marks: $('#lineMarks'), ladder: $('#lineLadder'), count: $('#lineCount') };
    lineEl.E = registerEarth(lineEl.input, $('#lineEarth'), lineEl.out, 0, 22);
    // Taking the handle hands the line to the visitor at the value it shows.
    var take = function () {
      if (state.budgetUser) return;
      var v = parseInt(lineEl.input.value, 10);
      setBudget(v >= B_MAX ? null : v, true, lineEl.input);
    };
    lineEl.input.addEventListener('pointerdown', take);
    lineEl.input.addEventListener('keydown', take);
    // axis labels are fixed positions on the price scale, not data
    var ticks = [100000, 200000, 300000, 400000, 500000, 600000];
    lineEl.axis.innerHTML = ticks.map(function (t) {
      var pct = (t - B_MIN) / (B_MAX - B_MIN) * 100;
      return '<li style="left:' + pct + '%"><span class="line__axis-us">US</span>$' + (t / 1000) + 'k' + (t === B_MAX ? '+' : '') + '</li>';
    }).join('');
    $$('#paySeg [data-pago]').forEach(function (b) {
      b.addEventListener('click', function () { setPago(b.getAttribute('data-pago')); });
    });
    $('#lineGo').addEventListener('click', function () { state.budgetUser = true; syncBudgetUI(); });
    // Keyboard: a control in a pinned act is only visible from p ~ 0.66. Park
    // the act there when focus lands inside it (the engine cannot know this).
    lineEl.stage.addEventListener('focusin', function () {
      var r = sec.getBoundingClientRect(), travel = sec.offsetHeight - innerHeight;
      var p = clamp(-r.top / Math.max(travel, 1), 0, 1);
      if (!reduce && p < 0.7) window.scrollTo({ top: Math.round(sec.offsetTop + travel * 0.8), behavior: 'instant' });
    });
  }
  // Several apartments in one condominium and no unit number: the pin names the code so they read apart.
  function sameCondo(a) { return state.data.apartamentos.filter(function (b) { return b.condominio === a.condominio; }).length; }
  function renderPins() {
    if (!state.data) return;
    var groups = {};
    state.data.apartamentos.forEach(function (a) { (groups[a.precioUSD] = groups[a.precioUSD] || []).push(a); });
    var html = '';
    Object.keys(groups).forEach(function (price) {
      groups[price].forEach(function (a, i) {
        var pct = (clamp(a.precioUSD, B_MIN, B_MAX) - B_MIN) / (B_MAX - B_MIN) * 100;
        var cover = a.fotos[a.portada || 0];
        html += '<div class="pin" data-price="' + a.precioUSD + '" data-stack="' + i + '" style="left:' + pct + '%">' +
          '<span class="pin__stem"></span>' +
          '<button class="pin__btn" type="button" data-open="' + a.id + '"><span class="pin__sprout">' +
            '<span class="pin__label"><span class="pin__name">' + esc(a.condominio) + (a.unidad ? ' ' + esc(a.unidad) : (sameCondo(a) > 1 ? ' ' + esc(a.codigo) : '')) + '</span>' +
            '<span class="pin__code">' + esc(a.codigo) + '</span><span class="pin__price">' + money(a.precioUSD) + '</span><span class="pin__fit"></span></span>' +
            '<span class="pin__drop"><img src="' + cover.thumb + '" alt="" width="120" height="120"></span>' +
          '</span></button></div>';
      });
    });
    lineEl.pins.innerHTML = html;
    renderLadder();
    $$('.pin__btn, .rung__btn', lineEl.stage).forEach(function (b) {
      b.addEventListener('click', function () { location.hash = '#/apto/' + b.getAttribute('data-open'); });
    });
    layoutPins();
    refreshPins();
  }
  // Phones (below 760px): the floating pins give way to a price ladder under
  // the line, one row per apartment from the cheapest up, each with its photo,
  // its real name, a short word that tells it apart, and its price. A small
  // mark on the line sits at each price, so line and rows stay tied. CSS
  // decides which of the two views shows; both are kept in sync here.
  // Name: the condominium, plus the unit when it still fits a phone row
  // ("RiOro B-11"). Second line: what tells it apart (unit, `etiqueta` from
  // the data) and the zone, unless the condominium already names it.
  function unitInName(a) { return a.unidad && (a.condominio + ' ' + a.unidad).length <= 16; }
  function rungName(a) { return a.condominio + (unitInName(a) ? ' ' + a.unidad : ''); }
  function rungSub(a) {
    var zoneSaid = a.condominio.toLowerCase().indexOf(String(a.zona).toLowerCase()) > -1;
    return [a.unidad && !unitInName(a) ? a.unidad : '', L(a.etiqueta) || tagFor(a), zoneSaid ? '' : a.zona].filter(Boolean).join(' · ');
  }
  function renderLadder() {
    var apts = state.data.apartamentos.slice().sort(function (a, b) { return a.precioUSD - b.precioUSD || a.codigo.localeCompare(b.codigo); });
    lineEl.ladder.innerHTML = apts.map(function (a, i) {
      var cover = a.fotos[a.portada || 0];
      return '<li class="rung" data-price="' + a.precioUSD + '" data-id="' + a.id + '" style="--i:' + i + '">' +
        '<button class="rung__btn" type="button" data-open="' + a.id + '">' +
          '<span class="rung__pin"><img src="' + cover.thumb + '" alt="" width="96" height="96" loading="lazy" decoding="async"></span>' +
          '<span class="rung__text"><span class="rung__name">' + esc(rungName(a)) + '</span><span class="rung__sub">' + esc(rungSub(a)) + '</span></span>' +
          '<span class="rung__price">' + money(a.precioUSD) + '</span>' +
          '<svg class="i rung__go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' +
        '</button></li>';
    }).join('');
    var seen = {};
    lineEl.marks.innerHTML = apts.filter(function (a) { return seen[a.precioUSD] ? false : (seen[a.precioUSD] = true); }).map(function (a) {
      var pct = (clamp(a.precioUSD, B_MIN, B_MAX) - B_MIN) / (B_MAX - B_MIN) * 100;
      return '<span class="mark" data-price="' + a.precioUSD + '" style="left:' + pct + '%"></span>';
    }).join('');
  }
  function layoutPins() {
    // Apartments that share a price stand side by side over one stem; groups
    // are kept apart and inside the plot. When one row of pins cannot fit the
    // width (five apartments on a phone), the groups alternate between two
    // rows: the stems still start at each exact price, only the tip rises.
    var pins = $$('.pin', lineEl.pins);
    if (!pins.length || !lineEl.pins.offsetParent) return;   // hidden on phones (the ladder shows instead)
    var W = lineEl.pins.clientWidth, gap = 8, sep = 14, groups = {};
    var plot = lineEl.pins;
    plot.classList.remove('is-stagger');
    pins.forEach(function (p) { p.querySelector('.pin__btn').style.bottom = ''; });
    pins.forEach(function (p) { (groups[p.getAttribute('data-price')] = groups[p.getAttribute('data-price')] || []).push(p); });
    var G = Object.keys(groups).map(function (k) {
      var g = groups[k], x = g[0].offsetLeft;
      var widths = g.map(function (p) { return p.querySelector('.pin__btn').offsetWidth || 120; });
      var total = widths.reduce(function (s, w) { return s + w; }, 0) + gap * (g.length - 1);
      return { pins: g, x: x, widths: widths, total: total, left: x - total / 2, tier: 0 };
    }).sort(function (a, b) { return a.x - b.x; });
    var need = G.reduce(function (s, g) { return s + g.total; }, 0) + sep * (G.length - 1);
    var stagger = need > W && G.length > 2;
    if (stagger) {
      plot.classList.add('is-stagger');
      G.forEach(function (g, i) { g.tier = i % 2; });
      // widths and heights can change with the smaller drop
      G.forEach(function (g) { g.widths = g.pins.map(function (p) { return p.querySelector('.pin__btn').offsetWidth || 120; }); g.total = g.widths.reduce(function (s, w) { return s + w; }, 0) + gap * (g.pins.length - 1); g.left = g.x - g.total / 2; });
    }
    var tiers = stagger ? [G.filter(function (g) { return g.tier === 0; }), G.filter(function (g) { return g.tier === 1; })] : [G];
    tiers.forEach(function (T) {
      T.forEach(function (g, i) { g.left = Math.max(g.left, 0, i ? T[i - 1].left + T[i - 1].total + sep : 0); });
      for (var i = T.length - 1; i >= 0; i--) {
        var limit = i === T.length - 1 ? W : T[i + 1].left - sep;
        if (T[i].left + T[i].total > limit) T[i].left = limit - T[i].total;
      }
    });
    var rise = 0;
    if (stagger) {
      var hmax = 0;
      pins.forEach(function (p) { hmax = Math.max(hmax, p.querySelector('.pin__btn').offsetHeight); });
      rise = hmax + 8;
    }
    G.forEach(function (g) {
      var left = g.left - g.x;
      g.pins.forEach(function (p, i) {
        var btn = p.querySelector('.pin__btn');
        btn.style.left = left.toFixed(1) + 'px';
        var base = parseFloat(getComputedStyle(btn).bottom) || 30;
        if (g.tier) { base += rise; btn.style.bottom = base + 'px'; }
        var dx = left + g.widths[i] / 2;
        var stem = p.querySelector('.pin__stem');
        stem.style.height = Math.hypot(dx, base).toFixed(1) + 'px';
        stem.style.transform = 'rotate(' + Math.atan2(dx, base).toFixed(4) + 'rad)';
        left += g.widths[i] + gap;
      });
    });
  }
  var demoV = B_MIN;
  function refreshPins() {
    if (!lineEl.pins) return;
    var showV = state.budgetUser ? (state.budget == null ? B_MAX : state.budget) : demoV;
    var fitSig = '';
    $$('.pin', lineEl.pins).forEach(function (p) {
      var price = +p.getAttribute('data-price');
      var seed = !state.budgetUser && !reduce && price > demoV;
      var out = state.budgetUser && state.budget != null && price > state.budget;
      p.classList.toggle('is-seed', seed);
      p.classList.toggle('is-out', out);
      var fit = p.querySelector('.pin__fit');
      fit.textContent = state.budgetUser && state.budget != null ? (out ? T('over') : T('fits')) : '';
      fitSig += fit.textContent.length ? '1' : '0';
      p.querySelector('.pin__btn').setAttribute('aria-label', p.querySelector('.pin__name').textContent + ', ' + money(price) + (fit.textContent ? ', ' + fit.textContent : ''));
    });
    // the "fits / over budget" line changes a pin's size: lay the pins out again when it appears or goes
    if (fitSig !== lineEl.fitSig) { var first = lineEl.fitSig === undefined; lineEl.fitSig = fitSig; if (!first) layoutPins(); }
    // the ladder rows and the marks on the line follow the same three states
    var fitN = 0, rungs = $$('.rung', lineEl.ladder);
    rungs.forEach(function (r) {
      var price = +r.getAttribute('data-price');
      var seed = !state.budgetUser && !reduce && price > demoV;
      var out = state.budgetUser && state.budget != null && price > state.budget;
      var lit = !seed && !out;
      if (lit) fitN++;
      r.classList.toggle('is-seed', seed);
      r.classList.toggle('is-out', out);
      r.classList.toggle('is-in', lit);
      var fitTxt = state.budgetUser && state.budget != null ? (out ? T('over') : T('fits')) : '';
      r.querySelector('.rung__btn').setAttribute('aria-label', r.querySelector('.rung__name').textContent + ', ' + r.querySelector('.rung__sub').textContent + ', ' + money(price) + (fitTxt ? ', ' + fitTxt : ''));
    });
    $$('.mark', lineEl.marks).forEach(function (m) {
      var price = +m.getAttribute('data-price');
      m.classList.toggle('is-seed', !state.budgetUser && !reduce && price > demoV);
      m.classList.toggle('is-out', state.budgetUser && state.budget != null && price > state.budget);
    });
    if (lineEl.count && rungs.length) {
      var t = rungs.length;
      lineEl.count.textContent = fitN === t ? T('ladderAll', { t: t }) : fitN === 0 ? T('ladderNone') : T('ladderCount', { n: fitN, t: t });
      lineEl.count.classList.toggle('is-none', fitN === 0);
    }
    lineEl.stage.setAttribute('data-sc-verify-state', Math.round(showV / 1000) + '|' + $$('.pin.is-seed', lineEl.pins).length);
  }
  function lineFrame() {
    if (!lineEl.sec) return;
    var r = lineEl.sec.getBoundingClientRect();
    if (r.bottom < -50 || r.top > innerHeight + 50) return;
    var travel = lineEl.sec.offsetHeight - innerHeight;
    var p = clamp(-r.top / Math.max(travel, 1), 0, 1);
    if (!state.budgetUser) {
      var v = reduce ? B_MAX : B_MIN + (B_MAX - B_MIN) * smooth((p - 0.06) / 0.56);
      v = Math.round(v / 5000) * 5000;
      if (v !== demoV) {
        demoV = v;
        lineEl.input.value = v;
        lineEl.out.textContent = v >= B_MAX ? T('noLimit') : money(v);
        drawEarth(lineEl.E, v);
        refreshPins();
      }
      $('#lineAfter').classList.toggle('is-waiting', !reduce && p < 0.64);
    }
  }
  function setPago(p) {
    state.pago = p; store.set('pago', p);
    $$('#paySeg [data-pago]').forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-pago') === p)); });
    $$('#vPago input').forEach(function (i) { i.checked = i.value === p; });
    refreshVisit();
  }

  /* --------------------------------------------------- the catalogue -- */
  function populateFilters() {
    var apts = state.data.apartamentos;
    var uniq = function (k) { return apts.map(function (a) { return a[k]; }).filter(function (v, i, arr) { return v && arr.indexOf(v) === i; }).sort(); };
    var fill = function (sel, values, label) {
      var first = sel.options[0];
      sel.innerHTML = ''; sel.appendChild(first);
      values.forEach(function (v) { var o = document.createElement('option'); o.value = v.id || v; o.textContent = label ? label(v) : v; sel.appendChild(o); });
    };
    var count = function (pred) { return apts.filter(pred).length; };
    fill($('#fZona'), uniq('zona'), function (z) { return z + ' (' + count(function (a) { return a.zona === z; }) + ')'; });
    fill($('#fCondo'), uniq('condominio'), function (c) { return c + ' (' + count(function (a) { return a.condominio === c; }) + ')'; });
    // Only floors/types that at least one apartment has: an option that always
    // returns nothing is a dead end (piso-6 / piso-5 wait on Jorge confirming
    // the Bosques floor; they reappear by themselves once an apartment uses them).
    var pisoCount = function (t) { return count(function (a) { return a.pisoTipo.indexOf(t.id) > -1; }); };
    var pisos = state.data.taxonomia.pisoTipo.filter(function (t) { return pisoCount(t) > 0; });
    if (state.f.piso && !pisos.some(function (t) { return t.id === state.f.piso; })) state.f.piso = '';
    fill($('#fPiso'), pisos, function (t) { return L(t) + ' (' + pisoCount(t) + ')'; });
    $('#fZona').value = state.f.zona; $('#fCondo').value = state.f.condo; $('#fPiso').value = state.f.piso;
    $('#fHab').value = String(state.f.hab); $('#fSort').value = state.f.sort;
    // zone shortcuts in the paths block
    $('#pathZones').innerHTML = uniq('zona').map(function (z) {
      return '<button class="btn btn--quiet" type="button" data-zone="' + esc(z) + '">' + esc(T('zoneBtn', { z: z, n: count(function (a) { return a.zona === z; }) })) + '</button>';
    }).join('');
    $$('#pathZones [data-zone]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.f.zona = b.getAttribute('data-zone'); $('#fZona').value = state.f.zona; renderLedger();
        document.getElementById('apartamentos').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
      });
    });
  }
  function filtered() {
    var f = state.f;
    var list = state.data.apartamentos.filter(function (a) {
      if (f.zona && a.zona !== f.zona) return false;
      if (f.condo && a.condominio !== f.condo) return false;
      if (f.piso && a.pisoTipo.indexOf(f.piso) < 0) return false;
      if (f.hab && a.habitaciones < f.hab) return false;
      if (state.budget != null && a.precioUSD > state.budget) return false;
      return true;
    });
    list.sort(function (a, b) {
      var d = f.sort === 'desc' ? b.precioUSD - a.precioUSD : a.precioUSD - b.precioUSD;
      return d || a.codigo.localeCompare(b.codigo);
    });
    return list;
  }
  var ICON = {
    bed: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18V7M3 13h18v5M21 13a3 3 0 0 0-3-3h-7v3M7 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>',
    bath: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16v2a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-2ZM6 12V6a2 2 0 0 1 3.4-1.4M7 19l-1 2M17 19l1 2"/></svg>',
    area: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6M15 4h5v5M9 20H4v-5"/></svg>',
    car: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16V11l2-5h10l2 5v5M3 16h18v3h-3v-1H6v1H3v-3ZM7.5 13h.01M16.5 13h.01"/></svg>'
  };
  function chipsFor(a) {
    var c = [];
    c.push('<li>' + ICON.bed + esc(T('beds', { n: a.habitaciones })) + '</li>');
    c.push('<li>' + ICON.bath + esc(T(a.banoServicio ? 'bathsPlus' : 'baths', { n: a.banos })) + '</li>');
    c.push('<li>' + ICON.area + a.m2 + ' m²</li>');
    c.push('<li>' + ICON.car + esc(T('parking', { n: a.parqueos })) + '</li>');
    return c.join('');
  }
  function tagFor(a) {
    var tx = state.data.taxonomia.pisoTipo.filter(function (t) { return a.pisoTipo.indexOf(t.id) > -1; })[0];
    return tx ? L(tx) : '';
  }
  function renderLedger() {
    if (!state.data) return;
    var list = filtered(), total = state.data.apartamentos.length;
    // The noun agrees with the total ("1 de 3 apartamentos"), not with n.
    $('#catCount').textContent = T(total === 1 ? 'count1' : 'count', { n: list.length, t: total });
    $('#ledger').innerHTML = list.map(function (a) {
      var cover = a.fotos[a.portada || 0];
      var href = '#/apto/' + a.id;
      return '<li class="lot" data-id="' + a.id + '"><a class="lot__media" href="' + href + '" tabindex="-1" aria-hidden="true">' +
        '<img src="' + cover.src + '" srcset="' + cover.thumb + ' 560w, ' + cover.src + ' ' + cover.w + 'w" sizes="(max-width: 820px) 100vw, 55vw" width="' + cover.w + '" height="' + cover.h + '" alt="" loading="lazy" decoding="async"></a>' +
        '<div class="lot__body">' +
          '<p class="lot__tags"><span class="pill pill--forest">' + esc(a.zona) + '</span><span class="pill">' + esc(tagFor(a)) + '</span><span class="pill pill--line">' + esc(T('byAppt')) + '</span></p>' +
          '<h3 class="lot__title"><a href="' + href + '">' + esc(L(a.titulo)) + '</a></h3>' +
          '<p class="lot__where">' + esc(a.condominio + (a.unidad ? ' ' + a.unidad : '') + ', ' + a.zona + ', ' + a.provincia) + '</p>' +
          '<p class="lot__price">' + money(a.precioUSD) + '</p>' +
          '<ul class="chips">' + chipsFor(a) + '</ul>' +
          (state.budget != null ? '<p class="lot__fit">' + esc(T('fits')) + ' (' + esc(T('upTo', { v: money(state.budget) })) + ')</p>' : '') +
          '<p class="lot__code">' + esc(a.codigo) + '</p>' +
          '<div class="lot__actions"><a class="btn btn--solid" href="' + href + '">' + esc(T('seeListing')) + '</a>' +
          '<a class="btn btn--quiet" href="#contacto" data-visit="' + a.id + '">' + esc(T('visit')) + '</a></div>' +
        '</div></li>';
    }).join('');
    $('#ledgerEmpty').hidden = list.length > 0;
    bindVisitLinks($('#ledger'));
    refreshWa();
    relayoutSoon();
  }
  function bindFilters() {
    var map = { fZona: 'zona', fCondo: 'condo', fPiso: 'piso', fHab: 'hab', fSort: 'sort' };
    Object.keys(map).forEach(function (id) {
      $('#' + id).addEventListener('change', function (e) {
        var k = map[id]; state.f[k] = k === 'hab' ? parseInt(e.target.value, 10) || 0 : e.target.value;
        renderLedger();
      });
    });
    $('#fClear').addEventListener('click', function () {
      state.f = { zona: '', condo: '', piso: '', hab: 0, sort: 'asc' };
      $('#fZona').value = ''; $('#fCondo').value = ''; $('#fPiso').value = ''; $('#fHab').value = '0'; $('#fSort').value = 'asc';
      setBudget(null, true);
    });
  }
  function bindVisitLinks(root) {
    $$('[data-visit]', root).forEach(function (a) {
      a.addEventListener('click', function () { chooseVisitApt(a.getAttribute('data-visit')); goStep(2); });
    });
  }

  /* ------------------------------------------------------ dossiers -- */
  var dlg, gal = { i: 0, a: null };
  function factRow(label, value) { return '<div><dt>' + esc(label) + '</dt><dd>' + txt(value) + '</dd></div>'; }
  function listBlock(title, arr) {
    if (!arr || !arr.length) return '';
    return '<div class="dos__block"><h3>' + esc(title) + '</h3><ul>' + arr.map(function (s) { return '<li>' + txt(s) + '</li>'; }).join('') + '</ul></div>';
  }
  function openDossier(id) {
    var a = state.data && state.data.apartamentos.filter(function (x) { return x.id === id; })[0];
    if (!a) { if (state.data && dlg.open) closeDossier(); return; }  // unknown id: never leave the previous one open
    gal = { i: 0, a: a };
    var yes = T('yes'), no = T('no');
    var fitLine = state.budget != null
      ? '<p><strong>' + esc(T('yourBudget')) + ':</strong> ' + esc(T('upTo', { v: money(state.budget) })) + '. ' + esc(a.precioUSD <= state.budget ? T('fits') : T('over')) + '.</p>' : '';
    var html =
      '<div class="dos__top"><span class="dos__code">' + esc(a.codigo) + ' · ' + esc(a.zona) + '</span>' +
      '<button class="dos__close" type="button" id="dosClose" aria-label="' + esc(T('close')) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
      '<div class="dos__grid">' +
        '<div class="gal">' +
          '<figure class="gal__main"><img id="galImg" alt="" width="1400" height="1050">' +
          '<button class="gal__nav gal__nav--prev" type="button" id="galPrev" aria-label="' + esc(T('prev')) + '"><svg class="i i--flip" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>' +
          '<button class="gal__nav gal__nav--next" type="button" id="galNext" aria-label="' + esc(T('next')) + '"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>' +
          '<span class="gal__count" id="galCount" aria-live="polite"></span></figure>' +
          '<p class="gal__cap" id="galCap"></p>' +
          '<div class="gal__thumbs" id="galThumbs">' + a.fotos.map(function (f, i) {
            return '<button type="button" data-i="' + i + '" aria-label="' + esc(T('photo', { i: i + 1, n: a.fotos.length }) + ': ' + L(f.alt)) + '"><img src="' + f.thumb + '" alt="" loading="lazy" width="92" height="66"></button>';
          }).join('') + '</div>' +
        '</div>' +
        '<div class="dos__info">' +
          '<h2 class="dos__title" id="dosTitle">' + esc(L(a.titulo)) + '</h2>' +
          '<p class="dos__where">' + esc(a.condominio + (a.unidad ? ' ' + a.unidad : '') + ', ' + a.zona + ', ' + a.provincia + ', ' + a.pais) + '</p>' +
          '<p class="dos__price">' + money(a.precioUSD) + '</p>' +
          '<dl class="dos__facts">' +
            factRow(T('fArea'), a.m2 + ' m²') +
            factRow(T('fBeds'), String(a.habitaciones)) +
            factRow(T('fBaths'), a.banos + (a.banoServicio ? (state.lang === 'en' ? ' + service' : ' + servicio') : '')) +
            factRow(T('fFloor'), L(a.piso)) +
            factRow(T('fParking'), String(a.parqueos)) +
            // true/false only when a source says so; otherwise {es,en} text ([FALTA: ...])
            factRow(T('fStorage'), typeof a.bodega === 'boolean' ? (a.bodega ? yes : no) : L(a.bodega)) +
            factRow(T('fFurn'), L(a.amueblado)) +
            factRow(T('fFee'), L(a.cuotaCondominio)) +
            factRow(T('fYear'), L(a.anioConstruccion)) +
            factRow(T('fCondo'), a.condominio + (a.unidad ? ', ' + T('fUnit').toLowerCase() + ' ' + a.unidad : '')) +
          '</dl>' +
          '<div class="dos__note">' +
            '<p><strong>' + esc(T('byAppt')) + '.</strong> ' + (a.habitado ? esc(T('occupiedNote')) : '') + '</p>' +
            '<p><strong>' + esc(T('financing')) + ':</strong> ' + txt(L(a.financiamiento)) + '</p>' +
            '<p><strong>' + esc(T('cashDisc')) + ':</strong> ' + txt(L(a.descuentoContado)) + '</p>' +
            fitLine +
          '</div>' +
          '<div class="dos__actions">' +
            '<a class="btn btn--solid" href="#contacto" data-visit="' + a.id + '" id="dosVisit">' + esc(T('visit')) + '</a>' +
            '<a class="btn btn--quiet" target="_blank" rel="noopener" href="' + waLink(T('msgListing', { code: a.codigo, title: L(a.titulo), price: money(a.precioUSD) })) + '"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-wa"/></svg> ' + esc(T('waListing')) + '</a>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="dos__more">' +
        '<div class="dos__block"><h3>' + esc(T('about')) + '</h3>' + L(a.descripcion).map(function (p) { return '<p>' + txt(p) + '</p>'; }).join('') + '</div>' +
        '<div>' + listBlock(T('includes'), L(a.incluye)) + listBlock(T('near'), L(a.cerca)) + '</div>' +
        '<div>' + listBlock(T('amenities'), L(a.amenidades)) + listBlock(T('registry'), L(a.registro)) + '</div>' +
      '</div>';
    $('#dossierBody').innerHTML = html;
    $('#dosClose').addEventListener('click', closeDossier);
    $('#galPrev').addEventListener('click', function () { showPhoto(gal.i - 1); });
    $('#galNext').addEventListener('click', function () { showPhoto(gal.i + 1); });
    $$('#galThumbs button').forEach(function (b) { b.addEventListener('click', function () { showPhoto(+b.getAttribute('data-i')); }); });
    $('#dosVisit').addEventListener('click', function () { chooseVisitApt(a.id); goStep(2); closeDossier(true); });
    showPhoto(0);
    if (!dlg.open) { dlg.showModal(); document.documentElement.classList.add('has-dialog'); }
    $('#dossierBody').scrollTop = 0;
    $('#dosClose').focus();
  }
  function showPhoto(i) {
    var a = gal.a, n = a.fotos.length;
    gal.i = (i + n) % n;
    var f = a.fotos[gal.i], img = $('#galImg');
    img.src = f.src; img.width = f.w; img.height = f.h; img.alt = L(f.alt);
    $('#galCap').textContent = L(f.alt);
    $('#galCount').textContent = (gal.i + 1) + ' / ' + n;
    $$('#galThumbs button').forEach(function (b, k) { b.setAttribute('aria-current', String(k === gal.i)); });
    var cur = $('#galThumbs button[aria-current="true"]');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    var next = new Image(); next.src = a.fotos[(gal.i + 1) % n].src; // warm the next one
  }
  function closeDossier(keepHashToContact) {
    if (dlg.open) dlg.close();
    document.documentElement.classList.remove('has-dialog');
    if (/^#\/apto\//.test(location.hash)) history.replaceState(null, '', keepHashToContact === true ? '#contacto' : '#apartamentos');
    if (keepHashToContact === true) document.getElementById('contacto').scrollIntoView({ behavior: 'auto' });
  }
  function route() {
    var m = location.hash.match(/^#\/apto\/([\w-]+)/);
    if (m) openDossier(m[1]);
    else if (dlg.open) closeDossier();
  }

  /* --------------------------------------------------- visit form -- */
  function renderVisitChoices() {
    var apts = state.data.apartamentos.slice().sort(function (a, b) { return a.precioUSD - b.precioUSD || a.codigo.localeCompare(b.codigo); });
    $('#vApts').innerHTML = apts.map(function (a) {
      var c = a.fotos[a.portada || 0];
      return '<label class="choice"><input type="radio" name="vApt" value="' + a.id + '"' + (state.visitApt === a.id ? ' checked' : '') + '>' +
        '<img src="' + c.thumb + '" alt="" width="52" height="40" loading="lazy"><span>' + esc(L(a.titulo)) + '<br><small>' + esc(a.zona) + '</small></span>' +
        '<span class="choice__meta">' + money(a.precioUSD) + '</span></label>';
    }).join('') +
      '<label class="choice"><input type="radio" name="vApt" value="nose"' + (state.visitApt === 'nose' ? ' checked' : '') + '><span>' + esc(T('notSure')) + '<br><small>' + esc(T('notSureSub')) + '</small></span></label>';
    $$('#vApts input').forEach(function (i) { i.addEventListener('change', function () { state.visitApt = i.value; refreshVisit(); }); });
  }
  function chooseVisitApt(id) {
    state.visitApt = id;
    $$('#vApts input').forEach(function (i) { i.checked = i.value === id; });
    refreshVisit();
  }
  function goStep(n) {
    state.step = clamp(n, 1, 3);
    $$('[data-step]').forEach(function (s) { s.hidden = +s.getAttribute('data-step') !== state.step; });
    $$('[data-step-tab]').forEach(function (t) { t.classList.toggle('is-on', +t.getAttribute('data-step-tab') <= state.step); });
    $('#stepBack').hidden = state.step === 1;
    $('#stepNext').hidden = state.step === 3;
    $('#visitSend').hidden = state.step !== 3;
    relayoutSoon();
  }
  function visitMsg() {
    var a = state.data && state.data.apartamentos.filter(function (x) { return x.id === state.visitApt; })[0];
    // Only what the visitor actually picked goes in the message: nothing is
    // pre-answered for them.
    var lines = [T('msgVisitHead')];
    if (a) lines.push(T('msgApt') + ': ' + a.codigo + ', ' + L(a.titulo) + ' (' + money(a.precioUSD) + ')');
    else if (state.visitApt === 'nose') lines.push(T('msgApt') + ': ' + T('msgAptAny'));
    if (state.budgetUser) lines.push(T('msgBudget') + ': ' + (state.budget == null ? T('noLimit') : T('upTo', { v: money(state.budget) })));
    if (state.pago) lines.push(T('msgPay') + ': ' + T('pay')[state.pago]);
    var when = T('when')[$('#vWhen').value];
    if (when) lines.push(T('msgWhen') + ': ' + when);
    var name = $('#vName').value.trim();
    if (name) lines.push(T('msgName') + ': ' + name);
    var note = $('#vNote').value.trim();
    if (note) lines.push(T('msgNote') + ': ' + note);
    return lines.join('\n');
  }
  function refreshVisit() {
    if (!state.data) return;
    $('#visitPreview').textContent = visitMsg();
    var ok = $('#vName').value.trim().length > 0;
    var send = $('#visitSend');
    send.href = waLink(visitMsg());
    send.setAttribute('aria-disabled', String(!ok));
    if (ok) $('#vNameErr').hidden = true;
  }
  function bindVisit() {
    $('#stepNext').addEventListener('click', function () { goStep(state.step + 1); var s = $('[data-step="' + state.step + '"] input, [data-step="' + state.step + '"] select'); if (s) s.focus(); });
    $('#stepBack').addEventListener('click', function () { goStep(state.step - 1); });
    $$('#vPago input').forEach(function (i) { i.addEventListener('change', function () { setPago(i.value); }); });
    ['vName', 'vNote', 'vWhen'].forEach(function (id) { $('#' + id).addEventListener('input', refreshVisit); $('#' + id).addEventListener('change', refreshVisit); });
    $('#visitSend').addEventListener('click', function (e) {
      if ($('#vName').value.trim()) { state.sent.visit = true; renderDone(); return; }  // the link opens WhatsApp with the message
      e.preventDefault(); $('#vNameErr').hidden = false; $('#vName').focus();
    });
  }

  // After the WhatsApp link opens: say what is left to do, plus the reply-time
  // line. The reply time is Jorge's promise to make, so until he writes it the
  // line is a [FALTA]; build-public.py blanks it and then only the first
  // sentence shows online.
  function renderDone() {
    var reply = T('replyTime');
    var html = esc(T('sentWa')) + (reply ? ' ' + txt(reply) : '');
    [['visit', '#visitDone'], ['owner', '#ownerDone']].forEach(function (k) {
      var el = $(k[1]); if (!el) return;
      el.hidden = !state.sent[k[0]];
      if (state.sent[k[0]]) el.innerHTML = html;
    });
  }

  /* --------------------------------------------------- owner form -- */
  function ownerMsg() {
    var v = function (id) { return $('#' + id).value.trim(); };
    var lines = [T('msgOwnerHead')];
    if (v('oName')) lines.push(T('msgName') + ': ' + v('oName'));
    if (v('oWhere')) lines.push(T('msgOwnerWhere') + ': ' + v('oWhere'));
    if (v('oM2')) lines.push(T('msgOwnerM2') + ': ' + v('oM2'));
    if (v('oBeds')) lines.push(T('msgOwnerBeds') + ': ' + v('oBeds'));
    if (v('oFloor')) lines.push(T('msgOwnerFloor') + ': ' + v('oFloor'));
    if (v('oLived')) lines.push(T('msgOwnerLived') + ': ' + (v('oLived') === 'si' ? T('yes') : T('no')));
    if (v('oPrice')) lines.push(T('msgOwnerPrice') + ': ' + v('oPrice'));
    return lines.join('\n');
  }
  function bindOwner() {
    var send = $('#ownerSend'), note = $('#ownerNote');
    var upd = function () {
      var ok = $('#oName').value.trim().length > 0;
      send.setAttribute('aria-disabled', String(!ok));
      send.href = waLink(ownerMsg());
    };
    $$('#ownerForm input, #ownerForm select').forEach(function (i) { i.addEventListener('input', upd); i.addEventListener('change', upd); });
    send.addEventListener('click', function (e) {
      if ($('#oName').value.trim()) { state.sent.owner = true; renderDone(); return; }
      e.preventDefault(); note.textContent = T('ownerNeedName'); $('#oName').focus();
    });
    upd();
  }

  /* -------------------------------------------------- hero planes -- */
  var hero = {};
  var DOORC = [0.578, 0.477];   // centre of the doorway cut, as a fraction of the room photo
  var IW = 1775, IH = 1334;
  function heroLayout() {
    var vw = innerWidth, vh = hero.stage.clientHeight || innerHeight;
    var s = Math.max(vw / IW, vh / IH), w = IW * s, h = IH * s;
    var target = vw * (vw < 860 ? 0.64 : 0.58);
    var ox = w > vw + 1 ? clamp((target - DOORC[0] * w) / (vw - w), 0, 1) : 0.5;
    var left = (vw - w) * ox, top = (vh - h) * 0.5;
    $$('img', hero.room).forEach(function (img) { img.style.objectPosition = (ox * 100).toFixed(2) + '% 50%'; });
    hero.dx = left + DOORC[0] * w; hero.dy = top + DOORC[1] * h; hero.vw = vw; hero.vh = vh;
    hero.room.style.transformOrigin = hero.dx.toFixed(1) + 'px ' + hero.dy.toFixed(1) + 'px';
    hero.view.style.transformOrigin = hero.dx.toFixed(1) + 'px ' + hero.dy.toFixed(1) + 'px';
  }
  var pm = { x: 0, y: 0, tx: 0, ty: 0 };
  function heroFrame() {
    var r = hero.sec.getBoundingClientRect();
    if (r.bottom < 0) return;
    var travel = hero.sec.offsetHeight - innerHeight;
    var p = clamp(-r.top / Math.max(travel, 1), 0, 1);
    pm.x += (pm.tx - pm.x) * 0.08; pm.y += (pm.ty - pm.y) * 0.08;
    // Short dissolve: a long crossfade between the full photo and the cut-out
    // reads as a double exposure in the left glass.
    var fullOp = 1 - smooth((p - 0.18) / 0.045);
    var walk = clamp((p - 0.06) / 0.8, 0, 1), we = walk * walk * 0.65 + walk * 0.35;
    var s = 1 + 2.5 * we;
    var tx = (hero.vw * 0.5 - hero.dx) * we + pm.x * -14, ty = (hero.vh * 0.5 - hero.dy) * we + pm.y * -9;
    var roomOp = 1 - smooth((p - 0.7) / 0.2);
    var vs = 1.2 - 0.2 * smooth(p / 0.95);
    hero.full.style.opacity = fullOp.toFixed(3);
    hero.scrim.style.opacity = (1 - smooth((p - 0.25) / 0.09)).toFixed(3); // leaves with the hero copy
    hero.room.style.opacity = roomOp.toFixed(3);
    hero.room.style.transform = 'translate3d(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px,0) scale(' + s.toFixed(4) + ')';
    hero.view.style.transform = 'translate3d(' + (pm.x * -5).toFixed(1) + 'px,' + (pm.y * -3 + (1 - p) * 12).toFixed(1) + 'px,0) scale(' + vs.toFixed(4) + ')';
    hero.room.style.visibility = roomOp < 0.002 ? 'hidden' : 'visible';
    hero.stage.setAttribute('data-sc-verify-state', s.toFixed(2) + '|' + fullOp.toFixed(2) + '|' + vs.toFixed(3) + '|' + roomOp.toFixed(2));
  }
  function buildHero() {
    hero = { sec: $('#inicio'), stage: $('#heroStage'), room: $('#heroRoom'), full: $('#heroRoomFull'), view: $('#heroView'), scrim: $('.vt-scrim--hero') };
    hero.view = hero.view.parentNode; // move the whole view plane (photo + haze)
    heroLayout();
    if (finePointer && !reduce) {
      hero.stage.addEventListener('pointermove', function (e) {
        pm.tx = (e.clientX / innerWidth) * 2 - 1; pm.ty = (e.clientY / innerHeight) * 2 - 1;
      });
      hero.stage.addEventListener('pointerleave', function () { pm.tx = 0; pm.ty = 0; });
    }
  }

  /* ------------------------------------------------------- the loop -- */
  function loop() {
    if (!reduce) heroFrame();
    lineFrame();
    requestAnimationFrame(loop);
  }

  var scApi = null, relayoutT = 0;
  function relayoutSoon() {
    clearTimeout(relayoutT);
    relayoutT = setTimeout(function () { if (scApi) { scApi.layout(); scApi.read(); } }, 60);
  }

  /* ----------------------------------------------------------- boot -- */
  function boot() {
    dlg = $('#dossier');
    if (reduce) {
      // Static composition: no pinned travel, nothing hidden behind a scroll cue.
      $('#inicio').setAttribute('data-sc-span', '1');
      $('#presupuesto').setAttribute('data-sc-span', '1');
      $$('#inicio [data-sc-cue]').forEach(function (el) { el.removeAttribute('data-sc-cue'); el.removeAttribute('data-sc-kinetic'); });
      $('#heroRoomFull').style.opacity = '1';
    }
    captureSpanish();
    if (state.lang !== 'es') applyLang();
    buildHero();
    buildLine();
    registerEarth($('#fBudget'), $('.filters .earth-mini__svg'), $('#fBudgetOut'), 15, 12);
    registerEarth($('#vBudget'), $('.visit-form .earth-mini__svg'), $('#vBudgetOut'), 15, 12);
    bindFilters(); bindVisit(); bindOwner();
    if (state.pago) setPago(state.pago);
    goStep(1);
    refreshWa();

    scApi = window.ScrollCraft.mount(document.body);

    $('#langToggle').addEventListener('click', function () {
      state.lang = state.lang === 'es' ? 'en' : 'es';
      applyLang();
      // kinetic headings were split by the engine; let it split the new text
      if (scApi) scApi.acts.forEach(function (a) { a.cues.forEach(function (q) {
        if (q.kinetic) { q.el.__scSplit = null; q.units = null; q.el.classList.remove('sc-is-split'); }
      }); });
      if (state.data) { populateFilters(); renderLedger(); renderPins(); renderVisitChoices(); refreshVisit(); }
      syncBudgetUI(); refreshWa(); renderDone();
      if (dlg.open && gal.a) { var i = gal.i; openDossier(gal.a.id); showPhoto(i); }
    });
    var bar = $('#bar'), mt = $('#menuToggle');
    mt.addEventListener('click', function () {
      var open = !bar.classList.contains('is-open');
      bar.classList.toggle('is-open', open); mt.setAttribute('aria-expanded', String(open));
      mt.setAttribute('aria-label', T(open ? 'menuClose' : 'menuOpen'));
    });
    $$('#barNav a').forEach(function (a) { a.addEventListener('click', function () { bar.classList.remove('is-open'); mt.setAttribute('aria-expanded', 'false'); }); });
    dlg.addEventListener('close', function () {
      document.documentElement.classList.remove('has-dialog');
      if (/^#\/apto\//.test(location.hash)) history.replaceState(null, '', '#apartamentos');
    });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) closeDossier(); });
    dlg.addEventListener('keydown', function (e) {
      if (!gal.a) return;
      if (e.key === 'ArrowLeft' && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) showPhoto(gal.i - 1);
      if (e.key === 'ArrowRight' && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) showPhoto(gal.i + 1);
    });
    $$('.faq details').forEach(function (d) { d.addEventListener('toggle', relayoutSoon); });
    if ('ResizeObserver' in window) {
      var lastH = 0;
      new ResizeObserver(function () {
        var h = document.body.scrollHeight; if (Math.abs(h - lastH) > 2) { lastH = h; relayoutSoon(); }
      }).observe(document.body);
    }
    addEventListener('resize', function () { heroLayout(); layoutPins(); syncBudgetUI(); if (!state.budgetUser) drawEarth(lineEl.E, demoV); });
    addEventListener('hashchange', route);

    fetch('data/apartamentos.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        state.data = data;
        populateFilters();
        renderLedger();
        renderPins();
        renderVisitChoices();
        syncBudgetUI();
        if (!state.budgetUser) drawEarth(lineEl.E, demoV);
        refreshVisit();
        route();
        relayoutSoon();
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutPins);
      })
      .catch(function (err) {
        console.error('[verti-terra] could not load data/apartamentos.json', err);
        $('#catCount').textContent = state.lang === 'en' ? 'Listings could not be loaded. Write to us on WhatsApp.' : 'No se pudieron cargar los apartamentos. Escríbenos por WhatsApp.';
      });

    requestAnimationFrame(loop);
    // test hook for the verification scripts (read-only view of state)
    window.__vt = { state: state, filtered: function () { return state.data ? filtered().map(function (a) { return a.id; }) : []; }, WA_NUMBER: WA_NUMBER };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
