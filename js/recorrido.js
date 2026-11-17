/* VT-01 walkthrough. Scrollcraft worldflight drives the scenes. This file only
   fills facts from data/apartamentos.json, swaps language, and turns on the
   three optional media slots when their files exist.

   Drop files here and reload. Nothing else needs editing:
     assets/recorrido/vt-01/dusk.jpg       tower at dusk (opening). dusk-m.jpg optional
     assets/recorrido/vt-01/planta.jpg     isometric plan (finale). planta-m.jpg optional
     assets/recorrido/vt-01/walk.mp4       scroll-scrubbed video. walk-m.mp4 optional
     assets/recorrido/vt-01/walk.jpg       still frame used when motion is reduced
     assets/recorrido/vt-01/frames/001.webp  frame sequence if there is no video
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
    frame: 'assets/recorrido/vt-01/frames/001.webp'
  };
  var AMENITY_WANT = ['Piscina temperada', 'Gimnasio', 'Sauna', 'Deck de yoga junto a la montaña', 'Seguridad 24 horas'];

  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var small = matchMedia('(max-width: 860px)').matches;
  var EN = window.VT_I18N.en;
  var lang = 'es';
  var apt = null;
  var data = null;
  var sc = null;
  var sceneIndex = 0;

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
    document.title = (en ? 'Walkthrough' : 'Recorrido') + ' · VT-01 · Verti Terra';
    try { localStorage.setItem('vt.lang', lang); } catch (e) {}
    refreshScene();
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
  function parking(a) {
    var n = a.parqueos;
    var word = lang === 'en' ? (n === 1 ? 'parking space' : 'parking spaces') : (n === 1 ? 'parqueo' : 'parqueos');
    return n + ' ' + word + (a.bodega === true ? (lang === 'en' ? ' + storage' : ' + bodega') : '');
  }
  function findFoto(src) {
    var list = data && data.apartamentos || [];
    for (var i = 0; i < list.length; i++) {
      var fotos = list[i].fotos || [];
      for (var j = 0; j < fotos.length; j++) if (fotos[j].src === src) return fotos[j];
    }
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

  function fill() {
    if (!apt) return;
    var where = apt.condominio + (apt.unidad ? ' ' + apt.unidad : '') + ', ' + apt.zona;
    setFill('unit', apt.unidad || apt.codigo);
    setFill('code', apt.codigo + ' · ' + apt.zona);
    setFill('title', L(apt.titulo));
    setFill('where', where);
    setFill('price', money(apt.precioUSD));
    setFill('m2', apt.m2 + ' m²');
    setFill('beds', String(apt.habitaciones));
    setFill('baths', apt.banos + (apt.banoServicio ? (lang === 'en' ? ' + service' : ' + servicio') : ''));
    setFill('parking', parking(apt));
    setFill('furn', L(apt.amueblado));
    setFill('fee', L(apt.cuotaCondominio));
    setFill('ocupacion', L(apt.ocupacion));
    var forest = forestText(apt);
    if (forest) setFill('forest', forest);
    ['vista', 'sala', 'cocina', 'balcon', 'hab', 'piscina'].forEach(function (id) {
      var img = $('#seg-' + id + ' img[data-src], #seg-' + id + ' img[src]');
      if (!img) return;
      var src = img.getAttribute('data-src') || img.getAttribute('src');
      var foto = findFoto(src);
      var alt = foto ? L(foto.alt) : '';
      if (alt) {
        img.alt = alt;
        setFill('cap-' + id, alt);
      }
    });
    var bosque = $('#seg-bosque img');
    if (bosque) {
      var enAlt = bosque.getAttribute('data-alt-en');
      if (lang === 'en' && enAlt) bosque.alt = enAlt;
      else if (bosque.__esAlt) bosque.alt = bosque.__esAlt;
    }
    var tag = L(apt.etiqueta) || L(apt.piso);
    setChips('dusk', [money(apt.precioUSD), apt.unidad, tag]);
    setChips('vista', [apt.m2 + ' m²']);
    setChips('sala', [beds(apt)]);
    setChips('cocina', [L(apt.amueblado)]);
    var balcAlt = ($('[data-fill="cap-balcon"]') || {}).textContent || '';
    setChips('balcon', [balconyChip(balcAlt)].filter(Boolean));
    setChips('hab', [beds(apt), baths(apt)]);
    setChips('bosque', forestChips(forest));
    setChips('piscina', amenityChips(apt));
    setChips('planta', [money(apt.precioUSD), apt.m2 + ' m²', parking(apt)]);
    var amen = $('[data-fill="amenList"]');
    if (amen) {
      amen.innerHTML = (L(apt.amenidades) || []).map(function (s) {
        return '<li>' + esc(s) + '</li>';
      }).join('');
    }
  }

  function refreshScene() {
    var b = $('#rwRail [data-go="' + sceneIndex + '"] .sr');
    var n = $('#rwSceneN'), l = $('#rwSceneL');
    if (n) n.textContent = pad(sceneIndex + 1);
    if (l && b) l.textContent = b.textContent;
  }

  function loadImage(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      var done = false;
      var finish = function (ok) { if (!done) { done = true; resolve(ok ? img : null); } };
      img.onload = function () { finish(true); };
      img.onerror = function () { finish(false); };
      img.src = url;
      setTimeout(function () { finish(false); }, 5000);
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
  function useStill(slotName, url, alt) {
    var img = $('[data-slot-img="' + slotName + '"]');
    var slot = $('[data-slot="' + slotName + '"]');
    if (!img || !url) return;
    img.src = url;
    img.hidden = false;
    if (alt) img.alt = alt;
    if (slot) slot.hidden = true;
  }
  function slotAlt(kind) {
    if (kind === 'dusk') return lang === 'en' ? 'Bosques de Escazú tower at dusk' : 'Torre de Bosques de Escazú al atardecer';
    if (kind === 'planta') return lang === 'en' ? 'Isometric floor plan of penthouse 603-A' : 'Planta isométrica del penthouse 603-A';
    return '';
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

  function mountVideo(src, mobile, poster) {
    var seg = $('#seg-video');
    if (!seg || seg.querySelector('video')) return;
    var v = document.createElement('video');
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    v.preload = 'none';
    v.setAttribute('data-sc-src', src);
    if (mobile) v.setAttribute('data-sc-src-mobile', mobile);
    seg.insertBefore(v, seg.firstChild);
    var slot = seg.querySelector('[data-slot]');
    var posterImg = seg.querySelector('[data-slot-img]');
    if (poster && posterImg) {
      posterImg.src = poster;
      posterImg.hidden = false;
      if (slot) slot.hidden = true;
    } else if (reduce && slot) {
      slot.classList.add('is-held');
      var held = slot.querySelector('.rw-slot__held');
      if (held) held.hidden = false;
    } else if (slot) {
      slot.hidden = true;
    }
  }

  function indexOfWaypoint(id) {
    var segs = $$('#vuelo [data-sc-segment]');
    for (var i = 0; i < segs.length; i++) if (segs[i].getAttribute('data-sc-waypoint') === id) return i;
    return -1;
  }
  function collectFrames(i, frames) {
    if (i > 180) return Promise.resolve(frames);
    var name = ('00' + i).slice(-3);
    return loadImage('assets/recorrido/vt-01/frames/' + name + '.webp').then(function (img) {
      if (!img) return frames;
      frames.push(img);
      return collectFrames(i + 1, frames);
    });
  }
  function startFrames() {
    if ($('#seg-video video')) return;
    loadImage(MEDIA.frame).then(function (first) {
      if (!first) return;
      if (reduce) { useStill('video', first.src, ''); return; }
      collectFrames(1, []).then(function (frames) {
        if (!frames.length) return;
        var seg = $('#seg-video');
        var canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        seg.appendChild(canvas);
        var slot = seg.querySelector('[data-slot]');
        if (slot) slot.hidden = true;
        var ctx = canvas.getContext('2d');
        var drawn = -1;
        function size() {
          var dpr = Math.min(window.devicePixelRatio || 1, 2);
          var w = seg.clientWidth || window.innerWidth;
          var h = seg.clientHeight || window.innerHeight;
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
          drawn = -1;
        }
        function draw(p) {
          var idx = Math.round(Math.max(0, Math.min(1, p)) * (frames.length - 1));
          if (idx === drawn) return;
          var img = frames[idx];
          if (!img || !img.naturalWidth) return;
          var cw = canvas.width, ch = canvas.height;
          var scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
          var w = img.naturalWidth * scale, h = img.naturalHeight * scale;
          ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
          drawn = idx;
        }
        size();
        window.addEventListener('resize', function () { size(); draw(0); });
        draw(0);
        var walkIndex = indexOfWaypoint('video');
        var flight = $('#vuelo');
        (function loop() {
          var idx = parseInt(flight.style.getPropertyValue('--sc-seg'), 10);
          if (idx === walkIndex) draw(parseFloat(flight.style.getPropertyValue('--sc-segp')) || 0);
          requestAnimationFrame(loop);
        })();
      });
    });
  }

  function bind() {
    var flight = $('#vuelo');
    flight.addEventListener('sc:waypoint', function (e) {
      sceneIndex = e.detail.index;
      $$('#rwRail button').forEach(function (b, i) {
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
      var i = +b.getAttribute('data-go');
      var W = sc.worlds[0];
      var seg = W.segs[i];
      if (!seg) return;
      var top = W.top + seg.c0 * window.innerHeight + 2;
      window.scrollTo({ top: top, behavior: (reduce || Math.abs(i - sceneIndex) > 1) ? 'auto' : 'smooth' });
    });
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
    var skip = $('.skip');
    if (skip) skip.addEventListener('click', function (e) {
      if (!sc) return;
      e.preventDefault();
      var W = sc.worlds[0];
      var last = W.segs[W.segs.length - 1];
      window.scrollTo({ top: W.top + last.c0 * window.innerHeight + 24, behavior: 'auto' });
      setTimeout(function () { var v = $('#rwVisit'); if (v) v.focus(); }, 80);
    });
  }

  function boot(media) {
    var bosque = $('#seg-bosque img');
    if (bosque) bosque.__esAlt = bosque.getAttribute('alt');
    scaleWeights();
    assignWindows();
    if (media.dusk) useStill('dusk', media.dusk, slotAlt('dusk'));
    if (media.plan) useStill('planta', media.plan, slotAlt('planta'));
    if (media.video) mountVideo(media.video, media.videoMobile, media.poster);
    armAround(0);
    armAround(1);
    sc = window.ScrollCraft.mount(document.body);
    bind();
    if (!media.video) startFrames();
    refreshScene();
  }

  capture();
  if (lang === 'en') applyLang();

  var dataP = fetch('data/apartamentos.json', { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }).catch(function (err) {
    console.warn('[recorrido] apartamentos.json', err);
    return null;
  });
  var still = function (full, mobile) {
    var url = full;
    var extra = small ? loadImage(mobile) : Promise.resolve(null);
    return extra.then(function (mob) {
      if (mob) return mob.src;
      return loadImage(url).then(function (img) { return img ? img.src : null; });
    });
  };

  Promise.all([
    dataP,
    still(MEDIA.dusk, MEDIA.duskMobile),
    still(MEDIA.plan, MEDIA.planMobile),
    probeFile(MEDIA.video),
    small ? probeFile(MEDIA.videoMobile) : Promise.resolve(null),
    loadImage(MEDIA.poster).then(function (img) { return img ? img.src : null; })
  ]).then(function (res) {
    data = res[0];
    if (data && data.apartamentos) {
      for (var i = 0; i < data.apartamentos.length; i++) {
        if (data.apartamentos[i].id === APT_ID) { apt = data.apartamentos[i]; break; }
      }
    }
    fill();
    boot({
      dusk: res[1],
      plan: res[2],
      video: res[3],
      videoMobile: res[4],
      poster: res[5]
    });
  });
})();
