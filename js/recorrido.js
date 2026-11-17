/* VT-01 walkthrough. Scrollcraft worldflight drives the scenes. This file fills
   facts from data/apartamentos.json, swaps language, and decides which of the
   three optional scenes exist.

   An optional scene (dusk opening, video, floor plan) is only in the page when
   its media file exists. While the file is missing the scene, its copy and its
   rail dot are removed before the engine mounts, so a buyer never sees a
   placeholder. Drop the file in and reload. Nothing else needs editing:
     assets/recorrido/vt-01/dusk.jpg       tower at dusk (becomes the opening). dusk-m.jpg optional
     assets/recorrido/vt-01/planta.jpg     isometric plan (finale). planta-m.jpg optional
     assets/recorrido/vt-01/walk.mp4       scroll-scrubbed video. walk-m.mp4 optional
     assets/recorrido/vt-01/walk.jpg       still frame of the video
     assets/recorrido/vt-01/frames/001.webp  frame sequence if there is no video
   Without dusk.jpg the walkthrough opens on the view scene.
*/
(function () {
  'use strict';

  var APT_ID = 'bosques-escazu-603a';
  var MEDIA = {
    dusk: 'assets/recorrido/vt-01/dusk.jpg',
    duskMobile: 'assets/recorrido/vt-01/dusk-m.jpg',
    plan: 'assets/recorrido/vt-01/planta.jpg',
    planMobile: 'assets/recorrido/vt-01/planta-m.jpg',
    video: 'assets/recorrido/vt-01/walk.mp4',
    videoMobile: 'assets/recorrido/vt-01/walk-m.mp4',
    poster: 'assets/recorrido/vt-01/walk.jpg',
    frames: 'assets/recorrido/vt-01/frames/'
  };
  var OPTIONAL = ['dusk', 'video', 'planta'];
  var CAPTIONED = ['vista', 'sala', 'cocina', 'balcon', 'hab'];
  var AMENITY_WANT = ['Piscina temperada', 'Gimnasio', 'Sauna', 'Deck de yoga junto a la montaña', 'Seguridad 24 horas'];
  /* The scroll track cannot be built until we know which optional scenes exist,
     so the probes are run in parallel and never hold the page longer than this.
     A file that answers later than this is simply left out of that visit. */
  var PROBE_MS = 2500;
  var MAX_FRAMES = 180;

  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var small = matchMedia('(max-width: 860px)').matches;
  var EN = window.VT_I18N.en;
  var lang = 'es';
  var apt = null;
  var data = null;
  var sc = null;
  var sceneIndex = 0;
  var firstScene = null;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  try { lang = localStorage.getItem('vt.lang') === 'en' ? 'en' : 'es'; } catch (e) {}

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function L(obj) {
    if (obj == null) return '';
    if (typeof obj === 'string') return obj;
    return obj[lang] != null ? obj[lang] : (obj.es || '');
  }
  function money(n) { return 'US$' + Number(n).toLocaleString('en-US'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function sentence(s) { return /[.!?]$/.test(s) ? s : s + '.'; }

  function capture() {
    $$('[data-i18n]').forEach(function (el) { if (el.__es == null) el.__es = el.innerHTML; });
    $$('[data-i18n-attr]').forEach(function (el) {
      if (el.__esAttr) return;
      el.__esAttr = {};
      el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        var a = pair.split(':')[0].trim();
        el.__esAttr[a] = el.getAttribute(a);
      });
    });
    $$('img[data-alt-en]').forEach(function (img) {
      if (img.__esAlt == null) img.__esAlt = img.getAttribute('alt') || '';
    });
  }
  function setTitle() {
    var m2 = apt ? apt.m2 : 223;
    document.title = (lang === 'en' ? 'Walkthrough: penthouse in Bosques de Escazú, ' : 'Recorrido: penthouse en Bosques de Escazú, ') +
      m2 + ' m² · Verti Terra';
  }
  function applyLang() {
    var en = lang === 'en';
    document.documentElement.lang = lang;
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
    setTitle();
    try { localStorage.setItem('vt.lang', lang); } catch (e) {}
    relabel();
    refreshScene();
  }

  /* Alt text that does not come from the JSON. Runs on every language change;
     fill() then overrides the photo alts with the JSON's own when it loaded. */
  function slotAlt(kind) {
    if (kind === 'dusk') return lang === 'en' ? 'Bosques de Escazú tower at dusk' : 'Torre de Bosques de Escazú al atardecer';
    if (kind === 'planta') return lang === 'en' ? 'Isometric floor plan of penthouse 603-A' : 'Planta isométrica del penthouse 603-A';
    if (kind === 'video') return lang === 'en' ? 'Still from the filmed walkthrough of the penthouse' : 'Fotograma del recorrido filmado del penthouse';
    return '';
  }
  function relabel() {
    $$('img[data-alt-en]').forEach(function (img) {
      img.alt = lang === 'en' ? img.getAttribute('data-alt-en') : img.__esAlt;
    });
    $$('img[data-slot-img]').forEach(function (img) {
      if (img.getAttribute('src')) img.alt = slotAlt(img.getAttribute('data-slot-img'));
    });
    CAPTIONED.forEach(function (id) {
      var img = $('#seg-' + id + ' img');
      var cap = $('[data-fill="cap-' + id + '"]');
      if (img && cap) img.alt = cap.textContent.replace(/\.\s*$/, '');
    });
  }

  function setFill(name, value) {
    $$('[data-fill="' + name + '"]').forEach(function (el) { el.textContent = value; });
  }
  function setChips(name, items) {
    var ul = $('[data-chips="' + name + '"]');
    if (!ul) return;
    ul.innerHTML = (items || []).filter(Boolean).map(function (t) {
      return '<li class="rw-chip">' + esc(t) + '</li>';
    }).join('');
  }
  function beds(a) {
    var n = a.habitaciones;
    return n + (lang === 'en' ? (n === 1 ? ' bedroom' : ' bedrooms') : (n === 1 ? ' habitación' : ' habitaciones'));
  }
  function baths(a) {
    var n = a.banos;
    var word = lang === 'en' ? (n === 1 ? 'bath' : 'baths') : (n === 1 ? 'baño' : 'baños');
    return n + ' ' + word + (a.banoServicio ? (lang === 'en' ? ' + service' : ' + servicio') : '');
  }
  function storage(a) { return a.bodega === true ? (lang === 'en' ? ' + storage' : ' + bodega') : ''; }
  function parking(a) {
    var n = a.parqueos;
    var word = lang === 'en' ? (n === 1 ? 'parking space' : 'parking spaces') : (n === 1 ? 'parqueo' : 'parqueos');
    return n + ' ' + word + storage(a);
  }
  function findFoto(src) {
    var fotos = (apt && apt.fotos) || [];
    for (var j = 0; j < fotos.length; j++) if (fotos[j].src === src) return fotos[j];
    return null;
  }
  function forestText(a) {
    var paras = L(a.descripcion);
    if (!paras || !paras.length) return '';
    for (var i = 0; i < paras.length; i++) {
      if (/13[,.]?000|reserva|reserve/i.test(paras[i])) return paras[i];
    }
    return paras[paras.length - 1] || '';
  }
  function forestChips(text) {
    var out = [];
    var area = String(text).match(/13,000 m²/);
    if (area) out.push(area[0]);
    if (/4 torres de baja densidad|4 low-density towers/i.test(text)) {
      out.push(lang === 'en' ? '4 low-density towers' : '4 torres de baja densidad');
    }
    return out;
  }
  function amenityChips(a) {
    var es = (a.amenidades && a.amenidades.es) || [];
    var list = L(a.amenidades) || [];
    var out = [];
    AMENITY_WANT.forEach(function (s) {
      var i = es.indexOf(s);
      if (i > -1 && list[i]) out.push(list[i]);
    });
    return out;
  }
  function balconyChip(alt) {
    if (/glass railing/i.test(alt)) return 'Glass railing';
    if (/baranda de vidrio/i.test(alt)) return 'Baranda de vidrio';
    return '';
  }

  /* Safe to call at any time and more than once: when the JSON lands, after
     the scenes are settled, and on every language change. Without the JSON the
     page keeps the text written in the HTML (and its English in i18n.js). */
  function fill() {
    if (!apt) return;
    var where = apt.condominio + (apt.unidad ? ' ' + apt.unidad : '') + ', ' + apt.zona;
    setTitle();
    setFill('unit', apt.unidad || apt.codigo);
    setFill('code', apt.codigo + ' · ' + apt.zona);
    setFill('title', L(apt.titulo));
    setFill('where', where);
    setFill('price', money(apt.precioUSD));
    setFill('m2', apt.m2 + ' m²');
    setFill('beds', String(apt.habitaciones));
    setFill('baths', apt.banos + (apt.banoServicio ? (lang === 'en' ? ' + service' : ' + servicio') : ''));
    setFill('parking', apt.parqueos + storage(apt));
    setFill('furn', L(apt.amueblado));
    setFill('fee', L(apt.cuotaCondominio));
    setFill('ocupacion', L(apt.ocupacion));
    var forest = forestText(apt);
    if (forest) setFill('forest', forest);
    /* Captions come from this listing's own photos only. The pool scene uses a
       photo from another unit, so its caption is fixed text about the condominium. */
    CAPTIONED.forEach(function (id) {
      var img = $('#seg-' + id + ' img');
      if (!img) return;
      var foto = findFoto(img.getAttribute('data-src') || img.getAttribute('src'));
      var alt = foto ? L(foto.alt) : '';
      if (alt) {
        img.alt = alt;
        setFill('cap-' + id, sentence(alt));
      }
    });
    var tag = L(apt.etiqueta) || L(apt.piso);
    var balcAlt = ($('[data-fill="cap-balcon"]') || {}).textContent || '';
    var chips = {
      dusk: [],
      vista: [apt.m2 + ' m²'],
      sala: [beds(apt)],
      cocina: [L(apt.amueblado)],
      balcon: [balconyChip(balcAlt)],
      hab: [beds(apt), baths(apt)],
      bosque: forestChips(forest),
      piscina: amenityChips(apt),
      planta: [money(apt.precioUSD), apt.m2 + ' m²', parking(apt)]
    };
    /* Whichever scene opens the walkthrough carries the price and the unit. */
    if (firstScene && chips[firstScene]) {
      chips[firstScene] = [money(apt.precioUSD), apt.unidad, tag].concat(chips[firstScene]);
    }
    Object.keys(chips).forEach(function (id) { setChips(id, chips[id]); });
    var amen = $('[data-fill="amenList"]');
    if (amen) {
      amen.innerHTML = (L(apt.amenidades) || []).map(function (s) {
        return '<li>' + esc(s) + '</li>';
      }).join('');
    }
  }

  function railButtons() { return $$('#rwRail button'); }
  function refreshScene() {
    var b = railButtons()[sceneIndex];
    var label = b && b.querySelector('.sr');
    var n = $('#rwSceneN'), l = $('#rwSceneL');
    if (n) n.textContent = pad(sceneIndex + 1);
    if (l && label) l.textContent = label.textContent;
  }

  /* ------------------------------------------------------------- probing */
  function loadImage(url, ms) {
    return new Promise(function (resolve) {
      var img = new Image();
      var done = false;
      var finish = function (ok) { if (!done) { done = true; resolve(ok ? img : null); } };
      img.onload = function () { finish(!!img.naturalWidth); };
      img.onerror = function () { finish(false); };
      img.src = url;
      setTimeout(function () { finish(false); }, ms || PROBE_MS);
    });
  }
  function probeFile(url) {
    return fetch(url, { method: 'HEAD' }).then(function (r) {
      if (r.ok) return url;
      if (r.status === 405 || r.status === 501) {
        return fetch(url, { headers: { Range: 'bytes=0-0' } }).then(function (r2) {
          return (r2.ok || r2.status === 206) ? url : null;
        }, function () { return null; });
      }
      return null;
    }, function () { return null; });
  }
  function capped(p) {
    return Promise.race([
      Promise.resolve(p).then(function (v) { return v || null; }, function () { return null; }),
      new Promise(function (resolve) { setTimeout(function () { resolve(null); }, PROBE_MS); })
    ]);
  }
  function imageUrl(url) {
    return loadImage(url).then(function (img) { return img ? img.src : null; });
  }
  /* Narrow screens prefer the -m file. Both are asked for at once, not in turn. */
  function still(full, mobile) {
    if (!small) return imageUrl(full);
    return Promise.all([imageUrl(mobile), imageUrl(full)]).then(function (r) { return r[0] || r[1]; });
  }
  function frameUrl(i) { return MEDIA.frames + ('00' + i).slice(-3) + '.webp'; }

  /* ------------------------------------------------------------- scenes */
  function dropScene(id) {
    [$('#seg-' + id), $('#vuelo [data-sc-copy][data-scene="' + id + '"]'), $('#rwRail [data-scene="' + id + '"]')]
      .forEach(function (el) { if (el && el.parentNode) el.parentNode.removeChild(el); });
  }
  function keepScene(id) {
    [$('#seg-' + id), $('#vuelo [data-sc-copy][data-scene="' + id + '"]'), $('#rwRail [data-scene="' + id + '"]')]
      .forEach(function (el) { if (el) el.hidden = false; });
  }
  function useStill(slotName, url) {
    var img = $('[data-slot-img="' + slotName + '"]');
    if (!img || !url) return;
    img.src = url;
    img.alt = slotAlt(slotName);
  }
  function mountVideo(src, mobile) {
    var seg = $('#seg-video');
    if (!seg || seg.querySelector('video')) return;
    var v = document.createElement('video');
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    v.setAttribute('aria-hidden', 'true');
    v.preload = 'none';
    v.setAttribute('data-sc-src', src);
    if (mobile) v.setAttribute('data-sc-src-mobile', mobile);
    seg.insertBefore(v, seg.firstChild);
  }
  /* Decide which optional scenes exist, and take the rest out of the page.
     Returns true when the video scene should run from a frame sequence. */
  function settleScenes(media) {
    var frame = media.frame ? media.frame.src : null;
    var videoStill = media.poster || frame;
    var has = {
      dusk: !!media.dusk,
      planta: !!media.plan,
      /* With reduced motion nothing is scrubbed, so the scene needs a still to show. */
      video: reduce ? !!((media.video || frame) && videoStill) : !!(media.video || frame)
    };
    OPTIONAL.forEach(function (id) { if (has[id]) keepScene(id); else dropScene(id); });
    if (has.dusk) useStill('dusk', media.dusk);
    if (has.planta) useStill('planta', media.plan);
    var useFrames = false;
    if (has.video) {
      if (videoStill) useStill('video', videoStill);
      if (!reduce && media.video) mountVideo(media.video, media.videoMobile);
      else if (!reduce) useFrames = true;
      if (reduce) $$('#vuelo [data-motion-only]').forEach(function (el) { el.hidden = true; });
    }
    return useFrames;
  }
  /* The first scene carries the page heading and the scroll hint, the last one
     carries the closing buttons, whichever scenes those turn out to be. */
  function placeEnds() {
    var segs = $$('#vuelo [data-sc-segment]');
    if (!segs.length) return;
    firstScene = segs[0].getAttribute('data-sc-waypoint');
    var lastScene = segs[segs.length - 1].getAttribute('data-sc-waypoint');
    var plate = function (id) { return $('#vuelo [data-sc-copy][data-scene="' + id + '"] .rw-plate'); };
    var hint = $('#rwHint'), actions = $('#rwActions');
    var firstPlate = plate(firstScene), lastPlate = plate(lastScene);
    if (hint && firstPlate && hint.parentNode !== firstPlate) firstPlate.appendChild(hint);
    if (actions && lastPlate && actions.parentNode !== lastPlate) lastPlate.appendChild(actions);
    if (firstScene !== 'vista') {
      var lead = firstPlate && firstPlate.querySelector('.rw-title');
      var vista = $('#vuelo [data-sc-copy][data-scene="vista"] .rw-title');
      if (lead) { lead.setAttribute('role', 'heading'); lead.setAttribute('aria-level', '1'); }
      if (vista) vista.setAttribute('aria-level', '2');
    }
  }

  function arm(img) {
    if (!img || img.getAttribute('src')) return;
    var src = img.getAttribute('data-src');
    if (!src) return;
    img.src = src;
  }
  function armAround(i) {
    var segs = $$('#vuelo [data-sc-segment]');
    for (var n = i - 1; n <= i + 2; n++) {
      if (segs[n]) arm(segs[n].querySelector('img.sc-world__poster'));
    }
  }
  function scaleWeights() {
    if (!small) return;
    $$('#vuelo [data-sc-segment]').forEach(function (s) {
      var w = parseFloat(s.getAttribute('data-sc-w')) || 1.3;
      s.setAttribute('data-sc-w', String(Math.max(1.05, Math.round(w * 0.84 * 100) / 100)));
    });
  }
  function assignWindows() {
    var segs = $$('#vuelo [data-sc-segment]');
    var weights = segs.map(function (s) { return parseFloat(s.getAttribute('data-sc-w')) || 1.3; });
    var total = weights.reduce(function (a, b) { return a + b; }, 0) || 1;
    var run = 0;
    segs.forEach(function (s, i) {
      var w = weights[i];
      var from = run / total;
      var to = (run + w) / total;
      run += w;
      var copy = $('#vuelo [data-sc-copy][data-scene="' + s.getAttribute('data-sc-waypoint') + '"]');
      if (!copy) return;
      if (i === 0) { copy.setAttribute('data-sc-window', 'hero'); return; }
      if (i === segs.length - 1) { copy.setAttribute('data-sc-window', 'finale'); return; }
      var span = to - from;
      var a = from + span * 0.08;
      var b = to - span * 0.06;
      if (b <= a) b = a + span * 0.5;
      copy.setAttribute('data-sc-window', a.toFixed(4) + ' ' + b.toFixed(4) + ' 0.34 0.4');
    });
  }
  function indexOfWaypoint(id) {
    var segs = $$('#vuelo [data-sc-segment]');
    for (var i = 0; i < segs.length; i++) if (segs[i].getAttribute('data-sc-waypoint') === id) return i;
    return -1;
  }

  /* -------------------------------------------------------- frame sequence */
  /* The first frame is already the scene's still. The rest are fetched only
     once the reader is one scene away, and the draw loop runs only while the
     video scene is the current one. */
  function collectFrames(i, frames) {
    if (i > MAX_FRAMES) return Promise.resolve(frames);
    return loadImage(frameUrl(i), 8000).then(function (img) {
      if (!img) return frames;
      frames.push(img);
      return collectFrames(i + 1, frames);
    });
  }
  function startFrames(first) {
    var seg = $('#seg-video');
    var flight = $('#vuelo');
    var walkIndex = indexOfWaypoint('video');
    if (!seg || !first || walkIndex < 0) return;
    var frames = [first];
    var canvas = null, ctx = null;
    var loading = false, ready = false, raf = 0, drawn = -1, lastP = 0;
    function size() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round((seg.clientWidth || window.innerWidth) * dpr);
      canvas.height = Math.round((seg.clientHeight || window.innerHeight) * dpr);
      drawn = -1;
    }
    function draw(p) {
      lastP = Math.max(0, Math.min(1, p));
      var idx = Math.round(lastP * (frames.length - 1));
      if (idx === drawn) return;
      var img = frames[idx];
      if (!img || !img.naturalWidth) return;
      var cw = canvas.width, ch = canvas.height;
      var scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
      var w = img.naturalWidth * scale, h = img.naturalHeight * scale;
      ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
      drawn = idx;
    }
    function loop() {
      raf = 0;
      if (sceneIndex !== walkIndex) return;
      draw(parseFloat(flight.style.getPropertyValue('--sc-segp')) || 0);
      raf = requestAnimationFrame(loop);
    }
    function run() {
      if (ready && !raf && sceneIndex === walkIndex) raf = requestAnimationFrame(loop);
    }
    function load() {
      if (loading) return;
      loading = true;
      collectFrames(2, frames).then(function () {
        if (frames.length < 2) return;
        canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        ctx = canvas.getContext('2d');
        seg.appendChild(canvas);
        size();
        draw(lastP);
        ready = true;
        window.addEventListener('resize', function () { size(); draw(lastP); });
        run();
      });
    }
    function near() { if (sceneIndex >= walkIndex - 1) load(); }
    flight.addEventListener('sc:waypoint', function () { near(); run(); });
    near();
  }

  /* ---------------------------------------------------------- navigation */
  /* scrollcraft.css sets scroll-behavior: smooth on the page, so a plain
     scrollTo glides through every scene on the way. Long jumps must be instant. */
  function jump(top, smooth) {
    top = Math.max(0, Math.round(top));
    if (smooth && !reduce) { window.scrollTo({ top: top, behavior: 'smooth' }); return; }
    var root = document.documentElement;
    var prev = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    window.scrollTo(0, top);
    root.style.scrollBehavior = prev;
  }
  /* A scroll position where scene i is settled: the photo has finished its
     crossfade and the scene's copy is fully legible. */
  function sceneTop(i) {
    var W = sc.worlds[0];
    var seg = W.segs[i];
    if (!seg || i <= 0) return W.top;
    if (i >= W.segs.length - 1) return W.top + W.total * window.innerHeight;
    return W.top + (seg.c0 + 0.4 * seg.w) * window.innerHeight;
  }

  function bind() {
    var flight = $('#vuelo');
    flight.addEventListener('sc:waypoint', function (e) {
      sceneIndex = e.detail.index;
      railButtons().forEach(function (b, i) {
        if (i === sceneIndex) b.setAttribute('aria-current', 'true');
        else b.removeAttribute('aria-current');
      });
      refreshScene();
      armAround(sceneIndex);
      $$('#vuelo [data-sc-copy]').forEach(function (c) {
        var on = c.getAttribute('data-scene') === e.detail.label;
        if (!on) { c.classList.remove('is-in'); return; }
        c.classList.remove('is-in');
        void c.offsetWidth;
        c.classList.add('is-in');
      });
    });
    $('#rwRail').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button');
      if (!b || !sc) return;
      var i = railButtons().indexOf(b);
      if (i < 0) return;
      jump(sceneTop(i), Math.abs(i - sceneIndex) <= 1);
    });
    /* The engine hides off-scene copy with opacity only, so a link inside it can
       take keyboard focus while invisible. Bring its scene on screen when it does. */
    flight.addEventListener('focusin', function (e) {
      var copy = e.target.closest && e.target.closest('[data-sc-copy]');
      if (!copy || !sc) return;
      if (parseFloat(getComputedStyle(copy).opacity || '1') > 0.85) return;
      var i = indexOfWaypoint(copy.getAttribute('data-scene'));
      if (i > -1) jump(sceneTop(i), false);
    });
    var skip = $('.skip');
    if (skip) skip.addEventListener('click', function (e) {
      if (!sc) return;
      e.preventDefault();
      jump(sceneTop(sc.worlds[0].segs.length - 1), false);
      setTimeout(function () {
        var v = $('#rwVisit');
        if (v) v.focus({ preventScroll: true });
      }, 80);
    });
  }
  function bindChrome() {
    var pop = $('#rwPop');
    function openPop() {
      if (pop.showModal) pop.showModal();
      else pop.setAttribute('open', '');
      $('#rwPopClose').focus();
    }
    function closePop() { if (pop.open && pop.close) pop.close(); }
    $('#rwUnit').addEventListener('click', openPop);
    $('#rwPopClose').addEventListener('click', closePop);
    pop.addEventListener('click', function (e) { if (e.target === pop) closePop(); });
    $('#langToggle').addEventListener('click', function () {
      lang = lang === 'en' ? 'es' : 'en';
      applyLang();
      fill();
    });
  }

  function boot(media) {
    var useFrames = settleScenes(media);
    placeEnds();
    scaleWeights();
    assignWindows();
    relabel();
    fill();
    armAround(0);
    armAround(1);
    /* Listen before mounting: the engine announces the first scene while it mounts. */
    bind();
    sc = window.ScrollCraft.mount(document.body);
    if (useFrames) startFrames(media.frame);
    refreshScene();
  }

  /* The bar, the facts popup and the language switch work straight away. Only
     the scroll track waits for the media probes, and only up to PROBE_MS. */
  capture();
  if (lang === 'en') applyLang();
  bindChrome();
  arm($('#seg-vista img'));

  fetch('data/apartamentos.json', { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }).then(function (json) {
    data = json;
    var list = (data && data.apartamentos) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === APT_ID) { apt = list[i]; break; }
    }
    fill();
  }).catch(function (err) {
    console.warn('[recorrido] apartamentos.json', err);
  });

  Promise.all([
    capped(still(MEDIA.dusk, MEDIA.duskMobile)),
    capped(still(MEDIA.plan, MEDIA.planMobile)),
    capped(probeFile(MEDIA.video)),
    capped(small ? probeFile(MEDIA.videoMobile) : null),
    capped(imageUrl(MEDIA.poster)),
    capped(loadImage(frameUrl(1)))
  ]).then(function (res) {
    boot({
      dusk: res[0],
      plan: res[1],
      video: res[2],
      videoMobile: res[3],
      poster: res[4],
      frame: res[5]
    });
  });
})();
