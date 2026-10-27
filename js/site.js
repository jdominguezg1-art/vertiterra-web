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
    guide: null,           // data/guia-primer-apartamento.json
    f: { zona: '', condo: '', piso: '', hab: 0, ban: 0, park: 0, pmin: 0, sort: 'asc' },
    sent: { owner: false }   // the visitor opened WhatsApp from the owner form
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
      if (f.ban) lines.push(T('msgBaths') + ': ' + f.ban + '+');
      if (f.park) lines.push(T('msgParking') + ': ' + f.park + '+');
      if (f.pmin) lines.push(T('msgPriceMin') + ': ' + money(f.pmin));
      lines.push(T('msgBudget') + ': ' + (state.budget == null ? T('noLimit') : T('upTo', { v: money(state.budget) })));
      return lines.join('\n');
    }
    if (kind === 'owner') return ownerMsg();
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
  // ("Río Oro B-11"). Second line: what tells it apart (unit, `etiqueta` from
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
    // Bedrooms, baths and parking: "N+" for every whole number an apartment
    // has, with how many have at least that many (2.5 baths counts for 2+).
    var mins = function (k) {
      return apts.map(function (a) { return Math.floor(a[k]); }).filter(function (v, i, arr) { return v > 0 && arr.indexOf(v) === i; }).sort(function (a, b) { return a - b; })
        .map(function (n) { return { id: String(n), n: n, c: count(function (a) { return a[k] >= n; }) }; });
    };
    var minLabel = function (o) { return T('optMin', { n: o.n, c: o.c }); };
    [['fHab', 'habitaciones', 'hab'], ['fBan', 'banos', 'ban'], ['fPark', 'parqueos', 'park']].forEach(function (x) {
      var opts = mins(x[1]);
      if (state.f[x[2]] && !opts.some(function (o) { return o.n === state.f[x[2]]; })) state.f[x[2]] = 0;
      fill($('#' + x[0]), opts, minLabel);
    });
    // Price from: US$50,000 steps between the cheapest and the dearest
    // apartment, keeping only steps that change the result.
    var prices = apts.map(function (a) { return a.precioUSD; });
    var pmins = [], lastC = apts.length;
    for (var v = Math.ceil((Math.min.apply(null, prices) + 1) / 50000) * 50000; v <= Math.max.apply(null, prices); v += 50000) {
      var c = count(function (a) { return a.precioUSD >= v; });
      if (c && c < lastC) { pmins.push({ id: String(v), v: v, c: c }); lastC = c; }
    }
    if (state.f.pmin && !pmins.some(function (o) { return o.v === state.f.pmin; })) state.f.pmin = 0;
    fill($('#fPMin'), pmins, function (o) { return T('optFrom', { v: money(o.v), c: o.c }); });
    $('#fZona').value = state.f.zona; $('#fCondo').value = state.f.condo; $('#fPiso').value = state.f.piso;
    $('#fHab').value = String(state.f.hab); $('#fBan').value = String(state.f.ban); $('#fPark').value = String(state.f.park);
    $('#fPMin').value = String(state.f.pmin); $('#fSort').value = state.f.sort;
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
      if (f.ban && a.banos < f.ban) return false;
      if (f.park && a.parqueos < f.park) return false;
      if (f.pmin && a.precioUSD < f.pmin) return false;
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
          '<a class="btn btn--quiet" href="#/visita/' + a.id + '">' + esc(T('visit')) + '</a></div>' +
        '</div></li>';
    }).join('');
    $('#ledgerEmpty').hidden = list.length > 0;
    refreshWa();
    relayoutSoon();
  }
  function bindFilters() {
    var map = { fZona: 'zona', fCondo: 'condo', fPiso: 'piso', fHab: 'hab', fBan: 'ban', fPark: 'park', fPMin: 'pmin', fSort: 'sort' };
    var numeric = { hab: 1, ban: 1, park: 1, pmin: 1 };
    Object.keys(map).forEach(function (id) {
      $('#' + id).addEventListener('change', function (e) {
        var k = map[id]; state.f[k] = numeric[k] ? parseInt(e.target.value, 10) || 0 : e.target.value;
        renderLedger();
      });
    });
    var clear = function () {
      state.f = { zona: '', condo: '', piso: '', hab: 0, ban: 0, park: 0, pmin: 0, sort: 'asc' };
      $('#fZona').value = ''; $('#fCondo').value = ''; $('#fPiso').value = ''; $('#fSort').value = 'asc';
      ['fHab', 'fBan', 'fPark', 'fPMin'].forEach(function (id) { $('#' + id).value = '0'; });
      setBudget(null, true);
    };
    $('#fClear').addEventListener('click', clear);
    // "no results": one tap back to every apartment, focus goes to the first filter
    $('#emptyReset').addEventListener('click', function () { clear(); $('#fZona').focus(); });
  }

  /* ------------------------------------------------------ the areas -- */
  // One card per zone, its condominiums inside. Facts come from data.zonas
  // (KB property cards); which apartments are where and the drive minutes are
  // read from the apartments themselves, so nothing is typed twice.
  function aptsWhere(match) {
    return state.data.apartamentos.filter(function (a) { return Object.keys(match).every(function (k) { return a[k] === match[k]; }); })
      .sort(function (a, b) { return a.precioUSD - b.precioUSD || a.codigo.localeCompare(b.codigo); });
  }
  function nearRange(list) {
    var by = {}, order = [];
    list.forEach(function (a) {
      var m = a.comoTeMueves; if (!m || !m.destinos) return;
      m.destinos.forEach(function (d) {
        var k = d.nombre.es;
        if (!by[k]) { by[k] = { name: L(d.nombre), lo: d.min, hi: d.min }; order.push(k); }
        by[k].lo = Math.min(by[k].lo, d.min); by[k].hi = Math.max(by[k].hi, d.min);
      });
    });
    return order.map(function (k) { var r = by[k]; return { name: r.name, text: r.lo === r.hi ? T('moveMin', { n: r.lo }) : T('minRange', { a: r.lo, b: r.hi }) }; });
  }
  function renderZones() {
    var grid = $('#zonesGrid'); if (!grid || !state.data.zonas) return;
    var zs = state.data.zonas;
    var list = function (arr) { return arr && arr.length ? '<ul class="zone__facts">' + arr.map(function (s) { return '<li>' + txt(s) + '</li>'; }).join('') + '</ul>' : ''; };
    grid.innerHTML = zs.filter(function (z) { return z.tipo === 'zona'; }).map(function (z) {
      var apts = aptsWhere(z.match);
      var near = nearRange(apts);
      var condos = zs.filter(function (c) {
        if (c.tipo !== 'condominio') return false;
        var ca = aptsWhere(c.match);
        return ca.length && ca.every(function (a) { return a.zona === z.match.zona; });
      });
      return '<article class="zone" data-zone-id="' + esc(z.id) + '">' +
        '<h3 class="zone__name">' + esc(z.nombre) + '</h3>' +
        '<p class="zone__for">' + txt(L(z.paraQuien)) + '</p>' +
        list(L(z.datos)) +
        (near.length ? '<h4 class="zone__h">' + esc(T('zoneNear')) + '</h4><ul class="zone__near">' + near.map(function (n) {
          return '<li><span>' + esc(n.name) + '</span><span class="zone__min">' + esc(n.text) + '</span></li>';
        }).join('') + '</ul>' : '') +
        condos.map(function (c) {
          return '<section class="condo" data-condo-id="' + esc(c.id) + '">' +
            '<p class="condo__kicker">' + esc(T('zoneCondo')) + '</p>' +
            '<h4 class="condo__name">' + esc(c.nombre) + '</h4>' +
            '<p class="zone__for">' + txt(L(c.paraQuien)) + '</p>' +
            list(L(c.datos)) +
            '<p class="zone__h">' + esc(T('zoneOurs')) + '</p>' +
            '<ul class="condo__apts">' + aptsWhere(c.match).map(function (a) {
              return '<li><a href="#/apto/' + a.id + '"><span class="condo__code">' + esc(a.codigo) + '</span><span class="condo__t">' + esc(L(a.titulo)) + '</span><span class="condo__p">' + money(a.precioUSD) + '</span></a></li>';
            }).join('') + '</ul>' +
            '<a class="condo__more" href="#/edificio/' + esc(condoSlug(c)) + '">' + esc(T('condoMore', { c: c.nombre })) + ' <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>' +
          '</section>';
        }).join('') +
      '</article>';
    }).join('');
    // footer: one link per condominium page
    var fc = $('#footCondos');
    if (fc) fc.innerHTML = condos().map(function (c) { return '<li><a href="#/edificio/' + esc(condoSlug(c)) + '">' + esc(c.nombre) + '</a></li>'; }).join('');
    relayoutSoon();
  }

  /* ------------------------------------------ one page per condominium -- */
  // #/edificio/<slug>. Everything comes from data.zonas (the condominium's
  // facts, amenities, who it suits) and from its apartments (prices, photos,
  // drive minutes), so a new apartment shows up here by itself.
  function condos() { return (state.data && state.data.zonas || []).filter(function (c) { return c.tipo === 'condominio' && aptsWhere(c.match).length; }); }
  function condoSlug(c) { return c.slug || c.id; }
  function zoneOf(c) {
    var a = aptsWhere(c.match)[0];
    return (state.data.zonas || []).filter(function (z) { return z.tipo === 'zona' && a && z.match.zona === a.zona; })[0];
  }
  function newestDate(list) { return list.map(function (a) { return a.actualizado || ''; }).sort().pop(); }
  function pageTop(label) {
    return '<div class="dos__top"><span class="dos__code">' + esc(label) + '</span>' +
      '<button class="dos__close" type="button" id="dosClose" aria-label="' + esc(T('closePage')) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>';
  }
  var ARROW = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  var WA_ICON = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-wa"/></svg>';
  function renderBuilding(c) {
    var apts = aptsWhere(c.match), z = zoneOf(c), a0 = apts[0];
    var near = nearRange(apts);
    var cover = a0.fotos[a0.portada || 0];
    var fecha = apts.map(function (a) { return a.comoTeMueves && a.comoTeMueves.fecha; }).filter(Boolean).sort().pop();
    var max = Math.max.apply(null, apts.reduce(function (m, a) { return m.concat((a.comoTeMueves && a.comoTeMueves.destinos || []).map(function (d) { return d.min; })); }, [30]));
    var hiOf = function (name) { var hi = 0; apts.forEach(function (a) { (a.comoTeMueves && a.comoTeMueves.destinos || []).forEach(function (d) { if (L(d.nombre) === name) hi = Math.max(hi, d.min); }); }); return hi; };
    var others = condos().filter(function (o) { return o.id !== c.id; });
    return pageTop(T('pageCondoKicker', { z: a0.zona })) +
      '<article class="page" data-page="edificio" data-condo-id="' + esc(c.id) + '">' +
        '<figure class="page__hero"><img src="' + cover.src + '" srcset="' + cover.thumb + ' 560w, ' + cover.src + ' ' + cover.w + 'w" sizes="(max-width: 900px) 100vw, 1180px" width="' + cover.w + '" height="' + cover.h + '" alt="' + esc(L(cover.alt)) + '"></figure>' +
        '<div class="page__wrap">' +
          '<header class="page__head">' +
            '<p class="page__crumbs"><a href="#zonas">' + esc(T('navZonesShort')) + '</a> <span aria-hidden="true">/</span> ' + esc(z ? z.nombre : a0.zona) + '</p>' +
            '<h2 class="page__title" id="dosTitle">' + esc(c.nombre) + '</h2>' +
            '<p class="page__where">' + esc(T('bWhereLine', { z: a0.zona, p: a0.provincia })) + '</p>' +
            '<div class="page__for"><span class="zone__h">' + esc(T('zoneFor')) + '</span><p>' + txt(L(c.paraQuien)) + '</p></div>' +
          '</header>' +
          '<div class="page__grid">' +
            '<section class="page__sec">' +
              '<h3 class="page__h">' + esc(T('bHas')) + '</h3>' +
              (c.amenidades ? '<ul class="amen">' + L(c.amenidades).map(function (s) { return '<li>' + txt(s) + '</li>'; }).join('') + '</ul>' : '') +
              '<h3 class="page__h">' + esc(T('bFacts')) + '</h3>' +
              '<ul class="page__facts">' + L(c.datos).map(function (s) { return '<li>' + txt(s) + '</li>'; }).join('') + '</ul>' +
            '</section>' +
            '<section class="page__sec dos__move">' +
              '<h3 class="page__h">' + esc(T('bWhere')) + '</h3>' +
              (near.length ? '<ul class="move">' + near.map(function (n) {
                return '<li class="move__row"><span class="move__name">' + esc(n.name) + '</span>' +
                  '<span class="move__bar" aria-hidden="true"><span style="width:' + (Math.max(hiOf(n.name), 1) / max * 100).toFixed(1) + '%"></span></span>' +
                  '<span class="move__min">' + esc(n.text) + '</span></li>';
              }).join('') + '</ul>' + (fecha ? '<p class="move__note">' + esc(T('moveNote', { d: dateText(fecha) })) + '</p>' : '') : '') +
              (z ? '<p class="page__zone"><strong>' + esc(z.nombre) + ':</strong> ' + txt(L(z.paraQuien)) + '</p>' : '') +
            '</section>' +
          '</div>' +
          '<section class="page__sec">' +
            '<h3 class="page__h">' + esc(T('zoneOurs')) + ' <span class="page__count">' + apts.length + '</span></h3>' +
            '<ul class="page__apts">' + apts.map(function (a) {
              var f = a.fotos[a.portada || 0];
              return '<li class="apt" data-id="' + a.id + '">' +
                '<a class="apt__media" href="#/apto/' + a.id + '" tabindex="-1" aria-hidden="true"><img src="' + f.thumb + '" alt="" width="560" height="420" loading="lazy" decoding="async"></a>' +
                '<div class="apt__body">' +
                  '<p class="apt__code">' + esc(a.codigo) + (a.unidad ? ' · ' + esc(a.unidad) : '') + '</p>' +
                  '<h4 class="apt__title"><a href="#/apto/' + a.id + '">' + esc(L(a.titulo)) + '</a></h4>' +
                  '<p class="apt__price">' + money(a.precioUSD) + '</p>' +
                  '<ul class="chips">' + chipsFor(a) + '</ul>' +
                  '<div class="apt__actions"><a class="btn btn--solid" href="#/apto/' + a.id + '">' + esc(T('seeListing')) + '</a>' +
                  '<a class="btn btn--quiet" href="#calculadora" data-calc-price="' + a.precioUSD + '">' + esc(T('bCalc')) + '</a></div>' +
                '</div></li>';
            }).join('') + '</ul>' +
          '</section>' +
          '<div class="page__cta">' +
            '<a class="btn btn--solid" target="_blank" rel="noopener" href="' + waLink(T('msgCondo', { c: c.nombre })) + '">' + WA_ICON + ' ' + esc(T('bAsk', { c: c.nombre })) + '</a>' +
            '<a class="btn btn--quiet" href="#/guia/' + GUIDE_ID + '">' + esc(T('bGuide')) + ' ' + ARROW + '</a>' +
          '</div>' +
          (others.length ? '<nav class="page__others" aria-label="' + esc(T('bOthers')) + '"><span class="zone__h">' + esc(T('bOthers')) + '</span>' + others.map(function (o) {
            return '<a href="#/edificio/' + esc(condoSlug(o)) + '">' + esc(o.nombre) + ' ' + ARROW + '</a>';
          }).join('') + '</nav>' : '') +
          '<p class="page__note">' + esc(T('bSourceNote')) + (newestDate(apts) ? ' ' + esc(T('updated', { d: dateText(newestDate(apts)) })) + '.' : '') + '</p>' +
        '</div>' +
      '</article>';
  }

  /* ------------------------------------------------- the buyer guide -- */
  // #/guia/primer-apartamento, text in data/guia-primer-apartamento.json. Marks
  // like {{apto:<id>}} or {{min:<id>:<place>}} are filled from the apartments,
  // so prices and minutes are never typed twice. **bold** and [text](#link)
  // (internal links only) are the only markup.
  var GUIDE_ID = 'primer-apartamento';
  function aptById(id) { return state.data.apartamentos.filter(function (a) { return a.id === id; })[0]; }
  function rich(s) {
    var h = esc(s).replace(/\{\{(apto|precio|codigo|min):([\w-]+)(?::([\w-]+))?\}\}/g, function (m, k, id, place) {
      var a = aptById(id); if (!a) return m;
      if (k === 'apto') return '<a href="#/apto/' + a.id + '">' + esc(a.codigo + ' · ' + L(a.titulo)) + '</a>';
      if (k === 'precio') return money(a.precioUSD);
      if (k === 'codigo') return esc(a.codigo);
      var d = (a.comoTeMueves && a.comoTeMueves.destinos || []).filter(function (x) { return x.id === place; })[0];
      return d ? esc(T('moveMin', { n: d.min })) : m;
    });
    h = h.replace(/\[([^\]]+)\]\((#[^)\s]*)\)/g, function (m, t, href) { return /^(FALTA|MISSING)/.test(t) ? m : '<a href="' + href + '">' + t + '</a>'; });
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    return h.replace(/\[(FALTA|MISSING)[^\]]*\]/g, function (m) { return '<mark class="missing">' + m + '</mark>'; });
  }
  function guideBlock(b, n) {
    if (b.tipo === 'h') return '<h3 class="guide__h"><span class="guide__n">' + (n < 10 ? '0' : '') + n + '</span>' + esc(L(b.texto)) + '</h3>';
    if (b.tipo === 'p') return '<p>' + rich(L(b.texto)) + '</p>';
    if (b.tipo === 'lista') return '<ul class="guide__list' + (b.check ? ' is-check' : '') + '">' + L(b.items).map(function (s) { return '<li>' + rich(s) + '</li>'; }).join('') + '</ul>';
    if (b.tipo === 'ejemplo-cierre') {
      var a = state.data.apartamentos.slice().sort(function (x, y) { return x.precioUSD - y.precioUSD; })[0];
      var c = closingCosts(a.precioUSD, CALC_RATE);
      return '<div class="guide__calc" data-total="' + Math.round(c.total) + '">' +
        '<p>' + esc(T('guideExample', { code: a.codigo, price: money(a.precioUSD), pct: c.pct.toFixed(1) })) + '</p>' +
        '<div class="guide__figs"><p><span>' + esc(T('calcColTotal')) + '</span><strong>' + money(Math.round(c.total)) + '</strong></p>' +
        '<p><span>' + esc(T('calcColHalf')) + '</span><strong>' + money(Math.round(c.half)) + '</strong></p></div>' +
        '<p class="guide__small">' + esc(T('guideRate', { r: CALC_RATE })) + ' <a href="#calculadora" data-calc-price="' + a.precioUSD + '">' + esc(T('guideCalcLink')) + '</a></p>' +
      '</div>';
    }
    if (b.tipo === 'cuotas') {
      return '<ul class="fees">' + state.data.apartamentos.slice().sort(function (x, y) { return x.precioUSD - y.precioUSD || x.codigo.localeCompare(y.codigo); }).map(function (a) {
        return '<li class="fee" data-id="' + a.id + '"><a class="fee__name" href="#/apto/' + a.id + '"><span class="fee__code">' + esc(a.codigo) + '</span>' + esc(a.condominio + (a.unidad ? ' ' + a.unidad : '')) + '</a>' +
          '<span class="fee__n"><strong>' + money(a.precioUSD) + '</strong><small>' + esc(T('perM2', { v: money(Math.round(a.precioUSD / a.m2)) })) + '</small></span>' +
          '<span class="fee__c"><small>' + esc(T('fFee')) + '</small>' + txt(L(a.cuotaCondominio)) + '</span></li>';
      }).join('') + '</ul>';
    }
    return '';
  }
  function renderGuide(g) {
    var n = 0;
    var apts = state.data.apartamentos.slice().sort(function (a, b) { return a.precioUSD - b.precioUSD || a.codigo.localeCompare(b.codigo); });
    return pageTop(T('guideKicker')) +
      '<article class="page guide" data-page="guia">' +
        '<header class="guide__head">' +
          '<p class="guide__kicker">' + esc(T('guideKicker')) + '</p>' +
          '<h2 class="guide__title" id="dosTitle">' + esc(L(g.titulo)) + '</h2>' +
          '<p class="guide__lede">' + esc(L(g.bajada)) + '</p>' +
          '<p class="guide__meta" id="guideUpdated">' + esc(T('updated', { d: dateText(g.actualizado) })) + '</p>' +
          '<p class="guide__aviso">' + esc(L(g.aviso)) + '</p>' +
        '</header>' +
        g.bloques.map(function (b) { if (b.tipo === 'h') n++; return guideBlock(b, n); }).join('') +
        '<div class="buy__help guide__help">' +
          '<h3 class="buy__h">' + esc(L(g.ayuda.titulo)) + '</h3><p>' + esc(L(g.ayuda.texto)) + '</p>' +
          '<ul class="guide__apts">' + apts.map(function (a) { return '<li><a href="#/apto/' + a.id + '"><span>' + esc(a.codigo + ' · ' + L(a.titulo)) + '</span><strong>' + money(a.precioUSD) + '</strong></a></li>'; }).join('') + '</ul>' +
          '<div class="page__cta"><a class="btn btn--light" href="#apartamentos">' + esc(T('guideSeeApts')) + '</a>' +
          '<a class="btn btn--light" target="_blank" rel="noopener" href="' + waLink(L(g.ayuda.whatsapp)) + '">' + WA_ICON + ' ' + esc(T('guideAsk')) + '</a></div>' +
        '</div>' +
        '<nav class="page__others" aria-label="' + esc(T('bCondos')) + '"><span class="zone__h">' + esc(T('bCondos')) + '</span>' + condos().map(function (o) {
          return '<a href="#/edificio/' + esc(condoSlug(o)) + '">' + esc(o.nombre) + ' ' + ARROW + '</a>';
        }).join('') + '</nav>' +
        '<section class="guide__sources"><h3>' + esc(T('guideSources')) + '</h3><ul>' + L(g.fuentes).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></section>' +
      '</article>';
  }

  // Open a condominium page or the guide in the same dialog as the dossiers.
  function openPage(kind, id) {
    var html = '', title = '';
    if (kind === 'edificio') {
      var c = condos().filter(function (x) { return condoSlug(x) === id; })[0];
      if (c) { html = renderBuilding(c); title = c.nombre; }
    } else if (kind === 'guia' && state.guide && id === state.guide.id) {
      html = renderGuide(state.guide); title = L(state.guide.titulo);
    } else if (kind === 'visita' && state.data) {
      vfFromHash(id); html = renderVisita(); title = T('vfKicker');
    }
    if (!html) { if (dlg.open) closeDossier(); return; }   // unknown page: never leave the previous one open
    gal = { i: 0, a: null };
    dlg.setAttribute('data-kind', kind);
    $('#dossierBody').innerHTML = html;
    $('#dosClose').addEventListener('click', closeDossier);
    if (kind === 'visita') bindVisita();
    document.title = title + ' · Verti Terra';
    if (!dlg.open) { dlg.showModal(); document.documentElement.classList.add('has-dialog'); }
    $('#dossierBody').scrollTop = 0;
    $('#dosClose').focus();
  }

  /* ------------------------------------------ closing-cost calculator -- */
  // Buyer's estimate from KNOWLEDGE/verti_terra_kb/WIKI/costos-de-cierre-cr.md:
  // transfer tax 1.5% (Ley 6999 art. 8); Registro 0.50% + agrarian 0.15% +
  // municipal 0.20% stamps (costaricalaw.com); bar-association stamp, fixed,
  // at most ₡55,000, + archive ₡20; notary scale of Decreto 41457-JP art. 74
  // (2% to ₡11M, 1.5% to ₡16.5M, 1.25% to ₡33M, 1% above, minimum ₡60,500)
  // + 13% IVA on the fee. Split half and half unless agreed (art. 68).
  // Pure: reads two numbers, writes the table, stores nothing.
  var CALC_RATE = 456.32;   // BCCR selling rate 26-oct-2026 via api.hacienda.go.cr (KB RAW/2026-10-26-comparables-encuentra24/_source.md)
  function notaryFeeCRC(crc) {
    var tiers = [[11000000, 0.02], [16500000, 0.015], [33000000, 0.0125], [Infinity, 0.01]];
    var fee = 0, prev = 0;
    tiers.forEach(function (t) { if (crc > prev) fee += (Math.min(crc, t[0]) - prev) * t[1]; prev = t[0]; });
    return Math.max(fee, 60500);
  }
  function closingCosts(usd, rate) {
    var notary = notaryFeeCRC(usd * rate) / rate;
    var c = { transfer: usd * 0.015, stamps: usd * 0.0085, bar: 55020 / rate, notary: notary, iva: notary * 0.13 };
    c.total = c.transfer + c.stamps + c.bar + c.notary + c.iva;
    c.half = c.total / 2;
    c.pct = c.total / usd * 100;
    return c;
  }
  function num(s) { s = String(s || '').replace(/[^\d.,]/g, ''); if (s.indexOf('.') < 0) s = s.replace(',', '.'); else s = s.replace(/,/g, ''); return parseFloat(s); }
  function renderCalc() {
    var out = $('#calcOut'); if (!out) return;
    var usd = Math.round(num($('#calcPrice').value.replace(/[.,]\d{1,2}$/, '').replace(/[.,]/g, '')));
    var rate = num($('#calcRate').value);
    if (!(rate >= 100 && rate <= 5000)) rate = CALC_RATE;
    if (!(usd >= 1000)) { out.innerHTML = '<p class="calc__empty">' + esc(T('calcEmpty')) + '</p>'; out.setAttribute('data-total', ''); return; }
    var c = closingCosts(usd, rate);
    var row = function (k, v, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + ' data-k="' + k + '"><th scope="row">' + esc(T(k)) + '</th><td>' + money(Math.round(v)) + '</td><td>' + money(Math.round(v / 2)) + '</td></tr>'; };
    out.innerHTML = '<table class="calc__table"><thead><tr><th></th><th scope="col">' + esc(T('calcColTotal')) + '</th><th scope="col">' + esc(T('calcColHalf')) + '</th></tr></thead><tbody>' +
      row('calcTransfer', c.transfer) + row('calcStamps', c.stamps) + row('calcBar', c.bar) + row('calcNotary', c.notary) + row('calcIva', c.iva) +
      row('calcTotal', c.total, 'calc__total') +
      '</tbody></table>' +
      '<p class="calc__big"><span>' + esc(T('calcHalf')) + '</span><strong id="calcHalf">' + money(Math.round(c.half)) + '</strong></p>' +
      '<p class="calc__pct">' + esc(T('calcPct', { p: c.pct.toFixed(1) })) + '</p>';
    out.setAttribute('data-total', String(Math.round(c.total)));
  }
  function renderCalcQuick() {
    var q = $('#calcQuick'); if (!q) return;
    q.innerHTML = state.data.apartamentos.slice().sort(function (a, b) { return a.precioUSD - b.precioUSD || a.codigo.localeCompare(b.codigo); }).map(function (a) {
      return '<button class="btn btn--quiet calc__chip" type="button" data-price="' + a.precioUSD + '">' + esc(a.codigo) + ' · ' + money(a.precioUSD) + '</button>';
    }).join('');
    $$('[data-price]', q).forEach(function (b) {
      b.addEventListener('click', function () { $('#calcPrice').value = Number(b.getAttribute('data-price')).toLocaleString('en-US'); renderCalc(); });
    });
  }
  function bindCalc() {
    if (!$('#calculadora')) return;
    ['calcPrice', 'calcRate'].forEach(function (id) { $('#' + id).addEventListener('input', renderCalc); });
    renderCalc();
  }

  /* ------------------------------------------------------ dossiers -- */
  var dlg, gal = { i: 0, a: null };
  // "2026-10-26" -> "26 de octubre de 2026" / "October 26, 2026" (own month
  // names: Intl would print "septiembre", the site writes "setiembre").
  function dateText(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    return T('date', { d: +m[3], m: T('months')[+m[2] - 1], y: m[1] });
  }
  // Four key figures under the price, plus price per m² and the update date.
  function summaryBlock(a) {
    var fig = function (n, label) { return '<li><span class="dos__fig">' + esc(n) + '</span><span class="dos__fig-l">' + esc(label) + '</span></li>'; };
    return '<ul class="dos__sum">' +
        fig(a.m2 + ' m²', T('fArea').toLowerCase()) +
        fig(String(a.habitaciones), T('sumBeds')) +
        fig(a.banos + (a.banoServicio ? ' + 1' : ''), T('sumBaths')) +
        fig(String(a.parqueos), T('sumParking')) +
      '</ul>' +
      '<p class="dos__meta">' + esc(T('perM2', { v: money(Math.round(a.precioUSD / a.m2)) })) +
        (a.actualizado ? ' · ' + esc(T('updated', { d: dateText(a.actualizado) })) : '') + '</p>';
  }
  // "Cómo te mueves": drive minutes from tools/drive-times.py (OSRM, no traffic).
  function moveBlock(a) {
    var m = a.comoTeMueves;
    var head = '<div class="dos__move"><h3>' + esc(T('move')) + '</h3>';
    // no location: tools/drive-times.py writes a "falta" note ({es, en}) instead of minutes
    if (!m || !m.destinos) return m && m.falta ? head + '<p>' + txt(L(m.falta)) + '</p></div>' : '';
    var max = Math.max.apply(null, m.destinos.map(function (d) { return d.min; }).concat([30]));
    return head + '<ul class="move">' + m.destinos.map(function (d) {
      return '<li class="move__row" data-place="' + esc(d.id) + '"><span class="move__name">' + esc(L(d.nombre)) + '</span>' +
        '<span class="move__bar" aria-hidden="true"><span style="width:' + (Math.max(d.min, 1) / max * 100).toFixed(1) + '%"></span></span>' +
        '<span class="move__min">' + esc(T('moveMin', { n: d.min })) + '</span></li>';
    }).join('') + '</ul><p class="move__note">' + esc(T('moveNote', { d: dateText(m.fecha) })) + '</p></div>';
  }
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
          summaryBlock(a) +
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
          moveBlock(a) +
          '<div class="dos__note">' +
            '<p><strong>' + esc(T('byAppt')) + '.</strong> ' + (a.habitado ? esc(T('occupiedNote')) : '') + '</p>' +
            '<p><strong>' + esc(T('financing')) + ':</strong> ' + txt(L(a.financiamiento)) + '</p>' +
            '<p><strong>' + esc(T('cashDisc')) + ':</strong> ' + txt(L(a.descuentoContado)) + '</p>' +
            fitLine +
          '</div>' +
          '<div class="dos__actions">' +
            '<a class="btn btn--solid" href="#/visita/' + a.id + '" id="dosVisit">' + esc(T('visit')) + '</a>' +
            '<a class="btn btn--quiet" target="_blank" rel="noopener" href="' + waLink(T('msgListing', { code: a.codigo, title: L(a.titulo), price: money(a.precioUSD) })) + '"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-wa"/></svg> ' + esc(T('waListing')) + '</a>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="dos__more">' +
        '<div class="dos__block"><h3>' + esc(T('about')) + '</h3>' + L(a.descripcion).map(function (p) { return '<p>' + txt(p) + '</p>'; }).join('') + '</div>' +
        '<div>' + listBlock(T('includes'), L(a.incluye)) + listBlock(T('near'), L(a.cerca)) + '</div>' +
        '<div>' + listBlock(T('amenities'), L(a.amenidades)) + listBlock(T('registry'), L(a.registro)) + '</div>' +
      '</div>';
    dlg.setAttribute('data-kind', 'apto');
    document.title = T('title');
    $('#dossierBody').innerHTML = html;
    $('#dosClose').addEventListener('click', closeDossier);
    $('#galPrev').addEventListener('click', function () { showPhoto(gal.i - 1); });
    $('#galNext').addEventListener('click', function () { showPhoto(gal.i + 1); });
    $$('#galThumbs button').forEach(function (b) { b.addEventListener('click', function () { showPhoto(+b.getAttribute('data-i')); }); });
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
  // Where a closed dialog leaves the address: an apartment goes back to the
  // list, a condominium page to "Dónde quedan", the guide to "Cómo comprar".
  var PAGE_RE = /^#\/(apto|edificio|guia|visita)(\/|$)/;
  var BACK_TO = { apto: '#apartamentos', edificio: '#zonas', guia: '#comprar', visita: '#apartamentos' };
  function backHash() { var m = location.hash.match(PAGE_RE); return m ? BACK_TO[m[1]] : null; }
  function closeDossier() {
    var back = backHash();
    if (dlg.open) dlg.close();
    document.documentElement.classList.remove('has-dialog');
    document.title = T('title');
    if (back) history.replaceState(null, '', back);
  }
  function route() {
    var m = location.hash.match(/^#\/(apto|edificio|guia)\/([\w-]+)/) || location.hash.match(/^#\/(visita)(?:\/([\w-]+))?\/?$/);
    if (m && m[1] === 'apto') openDossier(m[2]);
    else if (m) openPage(m[1], m[2]);
    else if (dlg.open) {
      // a link inside a page to a section of the home page (#calculadora, #zonas...)
      closeDossier();
      var t = /^#[\w-]+$/.test(location.hash) && document.getElementById(location.hash.slice(1));
      if (t) t.scrollIntoView({ behavior: 'auto' });
    }
  }

  /* ------------------------------------------- "Antes de tu visita" -- */
  // #/visita, or #/visita/<id> with that apartment already chosen. Same dialog
  // as the dossiers. Nothing is stored and nothing is sent: on submit the
  // answers become one message and WhatsApp opens with it, and the visitor
  // sends it or not. The answers live only in `vf` (memory, gone on reload) so
  // a language switch redraws the form without losing them.
  var VF_DAYS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
  var VF_TIMES = ['manana', 'mediodia', 'tarde'];
  var VF_STEP = 50000;
  var vf = { name: '', apt: '', min: '', max: '', pago: '', pre: '', people: '', days: [], times: [], note: '', consent: false, tried: false, sent: false, init: false, hashId: null };
  function vfFromHash(id) {
    if (!vf.init) {
      // what the visitor already told the page (budget line, payment) carries in
      vf.init = true;
      if (state.budgetUser && state.budget != null) vf.max = String(state.budget);
      if (state.pago) vf.pago = state.pago;
    }
    id = id || null;
    if (id !== vf.hashId) { vf.hashId = id; if (id && aptById(id)) vf.apt = id; }
  }
  function vfAmounts(from, to, extra) {
    var out = [];
    for (var v = from; v <= to; v += VF_STEP) out.push(String(v));
    if (extra && /^\d+$/.test(extra) && out.indexOf(extra) < 0) out.push(extra);
    return out.sort(function (a, b) { return a - b; });
  }
  function vfOptions(values, cur, label) {
    return values.map(function (v) { return '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(label(v)) + '</option>'; }).join('');
  }
  function vfChecks(name, ids, labels, cur) {
    return ids.map(function (id) {
      return '<label class="choice vf__chip"><input type="checkbox" name="' + name + '" value="' + id + '"' + (cur.indexOf(id) > -1 ? ' checked' : '') + '><span>' + esc(labels[id]) + '</span></label>';
    }).join('');
  }
  function vfRadios(name, ids, labels, cur) {
    return ids.map(function (id) {
      return '<label class="choice"><input type="radio" name="' + name + '" value="' + id + '"' + (cur === id ? ' checked' : '') + '><span>' + esc(labels[id]) + '</span></label>';
    }).join('');
  }
  function vfSorted() { return state.data.apartamentos.slice().sort(function (a, b) { return a.precioUSD - b.precioUSD || a.codigo.localeCompare(b.codigo); }); }
  function renderVisita() {
    var pick = '<option value="">' + esc(T('vfPick')) + '</option>';
    var people = ['1', '2', '3', '4', '5', '6'];
    var yn = { si: T('yes'), no: T('no') };
    return pageTop(T('byAppt')) +
      '<article class="page vf" data-page="visita">' +
        '<div class="page__wrap">' +
          '<header class="page__head">' +
            '<h2 class="page__title" id="dosTitle">' + esc(T('vfTitle')) + '</h2>' +
            '<p class="page__where">' + esc(T('vfLede')) + '</p>' +
          '</header>' +
          '<form class="vf__form" id="vfForm" novalidate>' +
            '<div class="vf__grid">' +
              '<div class="vf__cell"><label class="field"><span>' + esc(T('vfName')) + '</span><input id="vfName" type="text" autocomplete="name" required aria-required="true" aria-describedby="vfNameErr" value="' + esc(vf.name) + '"></label>' +
                '<p class="field__err" id="vfNameErr" hidden>' + esc(T('vfNameErr')) + '</p></div>' +
              '<label class="field vf__wide"><span>' + esc(T('vfApt')) + '</span><select id="vfApt">' + pick +
                vfSorted().map(function (a) { return '<option value="' + a.id + '"' + (vf.apt === a.id ? ' selected' : '') + '>' + esc(a.codigo + ' · ' + money(a.precioUSD) + ' · ' + L(a.titulo)) + '</option>'; }).join('') +
                '<option value="cualquiera"' + (vf.apt === 'cualquiera' ? ' selected' : '') + '>' + esc(T('vfAptAny')) + '</option></select></label>' +
            '</div>' +
            '<fieldset class="vf__set"><legend class="vf__q">' + esc(T('vfBudget')) + '</legend>' +
              '<div class="vf__grid vf__grid--pair">' +
                '<label class="field"><span>' + esc(T('vfMin')) + '</span><select id="vfMin">' + pick + vfOptions(vfAmounts(B_MIN, B_MAX - VF_STEP, vf.min), vf.min, function (v) { return money(v); }) + '</select></label>' +
                '<label class="field"><span>' + esc(T('vfMax')) + '</span><select id="vfMax">' + pick + vfOptions(vfAmounts(B_MIN + VF_STEP, B_MAX, vf.max), vf.max, function (v) { return money(v); }) +
                  '<option value="sin-tope"' + (vf.max === 'sin-tope' ? ' selected' : '') + '>' + esc(T('vfNoTop')) + '</option></select></label>' +
              '</div>' +
              '<p class="vf__hint" id="vfRangeNote" hidden>' + esc(T('vfRangeNote')) + '</p>' +
            '</fieldset>' +
            '<div class="vf__fit" id="vfFit" aria-live="polite"></div>' +
            '<fieldset class="vf__set"><legend class="vf__q">' + esc(T('vfPay')) + '</legend>' +
              '<div class="choices choices--row">' + vfRadios('vfPago', ['contado', 'credito', 'nose'], T('pay'), vf.pago) + '</div>' +
            '</fieldset>' +
            '<fieldset class="vf__set" id="vfPreSet"' + (vf.pago === 'credito' ? '' : ' hidden') + '><legend class="vf__q">' + esc(T('vfPre')) + '</legend>' +
              '<div class="choices choices--row vf__yn">' + vfRadios('vfPre', ['si', 'no'], yn, vf.pre) + '</div>' +
            '</fieldset>' +
            '<div class="vf__grid"><label class="field"><span>' + esc(T('vfPeople')) + '</span><select id="vfPeople">' + pick +
              vfOptions(people, vf.people, function (n) { return n === '6' ? T('vfSixPlus') : n; }) + '</select></label></div>' +
            '<fieldset class="vf__set"><legend class="vf__q">' + esc(T('vfDaysQ')) + '</legend>' +
              '<div class="vf__chips">' + vfChecks('vfDay', VF_DAYS, T('vfDays'), vf.days) + '</div>' +
            '</fieldset>' +
            '<fieldset class="vf__set"><legend class="vf__q">' + esc(T('vfTimesQ')) + '</legend>' +
              '<div class="vf__chips">' + vfChecks('vfTime', VF_TIMES, T('vfTimes'), vf.times) + '</div>' +
            '</fieldset>' +
            '<label class="field"><span>' + esc(T('vfNote')) + '</span><textarea id="vfNote" rows="3">' + esc(vf.note) + '</textarea></label>' +
            '<div class="vf__consent-box">' +
              '<label class="vf__consent"><input type="checkbox" id="vfConsent" required aria-required="true" aria-describedby="vfConsentErr vfPrivacy"' + (vf.consent ? ' checked' : '') + '><span>' + esc(T('vfConsent')) + '</span></label>' +
              '<p class="field__err" id="vfConsentErr" hidden>' + esc(T('vfConsentErr')) + '</p>' +
              '<p class="vf__privacy" id="vfPrivacy">' + esc(T('vfPrivacy', { n: WA_DISPLAY })) + '</p>' +
            '</div>' +
            '<div class="vf__actions"><button class="btn btn--solid" type="submit" id="vfSend">' + WA_ICON + ' ' + esc(T('vfSend')) + '</button></div>' +
            '<p class="form-done" id="vfDone" role="status"' + (vf.sent ? '' : ' hidden') + '></p>' +
            '<div class="preview"><p class="preview__label">' + esc(T('vfPreviewLabel')) + '</p><p class="preview__msg" id="vfPreview"></p></div>' +
          '</form>' +
        '</div>' +
      '</article>';
  }
  function vfMaxNum() { return /^\d+$/.test(vf.max) ? +vf.max : null; }
  // The broker's budget check: never blocks, only tells the visitor kindly
  // and shows what fits.
  function vfFitHtml() {
    var max = vfMaxNum();
    if (max == null) return '';
    var a = aptById(vf.apt);
    var fits = vfSorted().filter(function (x) { return x.precioUSD <= max; });
    if (a && a.precioUSD <= max) return '<p class="vf__fit-ok">' + esc(T('vfFitOk', { code: a.codigo })) + '</p>';
    var list = fits.length ? '<p>' + esc(T('vfFitList', { max: money(max) })) + '</p><ul class="vf__fits">' + fits.map(function (x) {
      return '<li><button class="vf__pick" type="button" data-pick="' + x.id + '"><span class="vf__pick-code">' + esc(x.codigo) + '</span>' +
        '<span class="vf__pick-t">' + esc(L(x.titulo)) + '</span><strong>' + money(x.precioUSD) + '</strong>' +
        '<span class="vf__pick-go">' + esc(T('vfFitPick')) + '</span></button></li>';
    }).join('') + '</ul>' : '<p>' + esc(T('vfFitNone', { max: money(max) })) + '</p>';
    return (a ? '<p><strong>' + esc(T('vfFitOver', { code: a.codigo, price: money(a.precioUSD), max: money(max) })) + '</strong></p>' : '') + list;
  }
  function vfMsg() {
    var lines = [T('vfMsgHead')];
    var name = vf.name.trim();
    if (name) lines.push(T('msgName') + ': ' + name);
    var a = aptById(vf.apt);
    if (a) lines.push(T('msgApt') + ': ' + a.codigo + ', ' + L(a.titulo) + ' (' + money(a.precioUSD) + ')');
    else if (vf.apt === 'cualquiera') lines.push(T('msgApt') + ': ' + T('vfMsgAny'));
    var lo = /^\d+$/.test(vf.min) ? money(+vf.min) : '', hi = vfMaxNum() != null ? money(vfMaxNum()) : '';
    var b = lo && hi ? T('vfRange', { a: lo, b: hi }) : lo && vf.max === 'sin-tope' ? T('vfFrom', { a: lo }) + ', ' + T('vfNoTop').toLowerCase()
      : lo ? T('vfFrom', { a: lo }) : hi ? T('vfTo', { b: hi }) : vf.max === 'sin-tope' ? T('vfNoTop') : '';
    if (b) lines.push(T('msgBudget') + ': ' + b);
    if (vf.pago) lines.push(T('msgPay') + ': ' + T('pay')[vf.pago] + (vf.pago === 'credito' && vf.pre ? ' (' + T('vfMsgPre', { v: (vf.pre === 'si' ? T('yes') : T('no')).toLowerCase() }) + ')' : ''));
    if (vf.people) lines.push(T('vfMsgPeople') + ': ' + (vf.people === '6' ? T('vfSixPlus') : vf.people));
    if (vf.days.length) lines.push(T('vfMsgDays') + ': ' + VF_DAYS.filter(function (d) { return vf.days.indexOf(d) > -1; }).map(function (d) { return T('vfDays')[d]; }).join(', '));
    if (vf.times.length) lines.push(T('vfMsgTimes') + ': ' + VF_TIMES.filter(function (t) { return vf.times.indexOf(t) > -1; }).map(function (t) { return T('vfTimes')[t]; }).join(', '));
    var note = vf.note.trim();
    if (note) lines.push(T('vfMsgNote') + ': ' + note);
    if (vf.consent) lines.push(T('vfConsent'));
    return lines.join('\n');
  }
  function vfRead() {
    var f = $('#vfForm'); if (!f) return;
    var checked = function (n) { return $$('input[name="' + n + '"]:checked', f).map(function (i) { return i.value; }); };
    vf.name = $('#vfName').value; vf.apt = $('#vfApt').value; vf.min = $('#vfMin').value; vf.max = $('#vfMax').value;
    vf.pago = checked('vfPago')[0] || ''; vf.pre = checked('vfPre')[0] || '';
    vf.people = $('#vfPeople').value; vf.days = checked('vfDay'); vf.times = checked('vfTime');
    vf.note = $('#vfNote').value; vf.consent = $('#vfConsent').checked;
  }
  function vfErrors() {
    var e = [];
    if (!vf.name.trim()) e.push('vfName');
    if (!vf.consent) e.push('vfConsent');
    return e;
  }
  function refreshVisita() {
    if (!$('#vfForm')) return;
    $('#vfPreSet').hidden = vf.pago !== 'credito';
    $('#vfRangeNote').hidden = !(/^\d+$/.test(vf.min) && vfMaxNum() != null && vfMaxNum() < +vf.min);
    var fit = vfFitHtml(), box = $('#vfFit');
    if (box.innerHTML !== fit) box.innerHTML = fit;   // empty box is hidden by CSS (:empty)
    var bad = vf.tried ? vfErrors() : [];
    $('#vfNameErr').hidden = bad.indexOf('vfName') < 0;
    $('#vfConsentErr').hidden = bad.indexOf('vfConsent') < 0;
    $('#vfName').setAttribute('aria-invalid', String(bad.indexOf('vfName') > -1));
    $('#vfConsent').setAttribute('aria-invalid', String(bad.indexOf('vfConsent') > -1));
    $('#vfPreview').textContent = vfMsg();
    var done = $('#vfDone');
    if (vf.sent) { var reply = T('replyTime'); done.innerHTML = esc(T('sentWa')) + (reply ? ' ' + txt(reply) : ''); }
  }
  function vfUrl() { return waLink(vfMsg()); }
  function bindVisita() {
    var f = $('#vfForm');
    var upd = function () { vfRead(); refreshVisita(); };
    f.addEventListener('input', upd);
    f.addEventListener('change', upd);
    // "these fit": choosing one swaps the apartment and keeps focus on the choice
    $('#vfFit').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-pick]'); if (!b) return;
      $('#vfApt').value = b.getAttribute('data-pick'); upd(); $('#vfApt').focus();
    });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      vfRead(); vf.tried = true;
      var bad = vfErrors();
      refreshVisita();
      if (bad.length) { $('#' + bad[0]).focus(); return; }
      // the visitor's own WhatsApp opens with the message; the page sends nothing
      window.open(vfUrl(), '_blank', 'noopener');
      vf.sent = true; $('#vfDone').hidden = false; refreshVisita();
    });
    refreshVisita();
  }

  // After the WhatsApp link opens: say what is left to do, plus the reply-time
  // line. The reply time is Jorge's promise to make, so until he writes it the
  // line is a [FALTA]; build-public.py blanks it and then only the first
  // sentence shows online.
  function renderDone() {
    var reply = T('replyTime');
    var html = esc(T('sentWa')) + (reply ? ' ' + txt(reply) : '');
    [['owner', '#ownerDone']].forEach(function (k) {
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
    bindFilters(); bindOwner(); bindCalc();
    if (state.pago) setPago(state.pago);
    refreshWa();

    scApi = window.ScrollCraft.mount(document.body);

    $('#langToggle').addEventListener('click', function () {
      state.lang = state.lang === 'es' ? 'en' : 'es';
      applyLang();
      // kinetic headings were split by the engine; let it split the new text
      if (scApi) scApi.acts.forEach(function (a) { a.cues.forEach(function (q) {
        if (q.kinetic) { q.el.__scSplit = null; q.units = null; q.el.classList.remove('sc-is-split'); }
      }); });
      if (state.data) { populateFilters(); renderLedger(); renderPins(); renderZones(); renderCalcQuick(); }
      renderCalc();
      syncBudgetUI(); refreshWa(); renderDone();
      if (dlg.open && gal.a) { var i = gal.i; openDossier(gal.a.id); showPhoto(i); }
      else if (dlg.open) route();   // a condominium page or the guide: draw it again in the new language
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
      document.title = T('title');
      var back = backHash(); if (back) history.replaceState(null, '', back);
    });
    // "Costos de cierre" links in the pages carry a price for the calculator
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-calc-price]');
      if (!a || !$('#calcPrice')) return;
      $('#calcPrice').value = Number(a.getAttribute('data-calc-price')).toLocaleString('en-US');
      renderCalc();
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

    // The buyer guide is optional: if it fails to load, the rest of the site still works.
    var guide = fetch('data/guia-primer-apartamento.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (g) { state.guide = g; })
      .catch(function (err) { console.warn('[verti-terra] guide not loaded', err); });
    fetch('data/apartamentos.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) { return guide.then(function () { return data; }); })
      .then(function (data) {
        state.data = data;
        populateFilters();
        renderLedger();
        renderPins();
        renderZones();
        renderCalcQuick();
        syncBudgetUI();
        if (!state.budgetUser) drawEarth(lineEl.E, demoV);
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
    window.__vt = { state: state, filtered: function () { return state.data ? filtered().map(function (a) { return a.id; }) : []; }, WA_NUMBER: WA_NUMBER, closingCosts: closingCosts, route: route,
      visita: { state: vf, url: function () { return state.data ? vfUrl() : ''; } } };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
