/*
 * Sala Muchik - funciones comunes
 * Pases de acceso (tokens), estado del programa y dibujo del escenario.
 * Desarrollado por Muchik Media | Apps
 */
(function () {
  'use strict';

  const CFG = Object.assign({
    livekitUrl: '',
    urlPublica: '',
    nombrePlataforma: 'Sala Muchik',
    credito: 'Muchik Media | Apps',
    colorMarca: '#e3001b',
    colorFondo: '#0f1419',
  }, window.SALA_CONFIG || {});

  const ID_DIRECTOR = 'director';
  const ID_PROGRAMA = 'programa';

  /* ------------------------------------------------------------ */
  /* Utilidades                                                    */
  /* ------------------------------------------------------------ */

  function $(sel, raiz) { return (raiz || document).querySelector(sel); }

  function crearEl(etiqueta, clase, texto) {
    const el = document.createElement(etiqueta);
    if (clase) el.className = clase;
    if (texto != null) el.textContent = texto;
    return el;
  }

  function leerLocal(clave, defecto) {
    try {
      const v = localStorage.getItem(clave);
      return v ? JSON.parse(v) : defecto;
    } catch (e) { return defecto; }
  }

  function guardarLocal(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* sin almacenamiento */ }
  }

  function borrarLocal(clave) {
    try { localStorage.removeItem(clave); } catch (e) { /* nada */ }
  }

  function aleatorio(n) {
    const letras = 'abcdefghijkmnpqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(n));
    let s = '';
    for (const b of bytes) s += letras[b % letras.length];
    return s;
  }

  function iniciales(nombre) {
    const partes = String(nombre || '?').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '?';
    const a = partes[0][0] || '';
    const b = partes.length > 1 ? partes[partes.length - 1][0] : '';
    return (a + b).toUpperCase();
  }

  function leerMeta(texto) {
    if (!texto) return {};
    try { const m = JSON.parse(texto); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; }
  }

  function debounce(fn, ms) {
    let t = null;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, args); }, ms);
    };
  }

  /** Dirección base donde viven las páginas (para armar los enlaces). */
  function urlBase() {
    if (CFG.urlPublica) return CFG.urlPublica.replace(/\/?$/, '/');
    const u = new URL(location.href);
    u.search = ''; u.hash = '';
    u.pathname = u.pathname.replace(/[^/]*$/, '');
    return u.toString();
  }

  /* ------------------------------------------------------------ */
  /* Pases de acceso (JWT firmado con el API Secret)               */
  /* ------------------------------------------------------------ */

  function b64url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlTexto(texto) { return b64url(new TextEncoder().encode(texto)); }

  function deB64url(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /**
   * Crea un pase de acceso para LiveKit.
   * o = { apiKey, apiSecret, sala, identidad, nombre, metadata, horas, permisos }
   */
  async function crearToken(o) {
    if (!o.apiKey || !o.apiSecret) throw new Error('Faltan las claves del proyecto');
    if (!window.crypto || !crypto.subtle) throw new Error('Este navegador no permite firmar pases (abre el panel desde https)');
    const ahora = Math.floor(Date.now() / 1000);
    const payload = {
      iss: o.apiKey,
      sub: o.identidad,
      jti: o.identidad + '-' + ahora + '-' + aleatorio(4),
      nbf: ahora - 120,
      exp: ahora + Math.round((o.horas || 24) * 3600),
      name: o.nombre || o.identidad,
      video: Object.assign({ room: o.sala, roomJoin: true }, o.permisos || {}),
    };
    if (o.metadata) payload.metadata = typeof o.metadata === 'string' ? o.metadata : JSON.stringify(o.metadata);
    const datos = b64urlTexto(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + b64urlTexto(JSON.stringify(payload));
    const clave = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(o.apiSecret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const firma = await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(datos));
    return datos + '.' + b64url(new Uint8Array(firma));
  }

  /** Lee el contenido de un pase (sin verificar la firma). */
  function leerToken(token) {
    try {
      const partes = String(token || '').split('.');
      if (partes.length !== 3) return null;
      return JSON.parse(deB64url(partes[1]));
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------ */
  /* Estado del programa (lo controla el director)                 */
  /* ------------------------------------------------------------ */

  function estadoInicial() {
    return {
      v: 1,
      enVivo: [],          // claves al aire: "identidad:cam" o "identidad:pantalla"
      destacado: null,     // clave destacada
      diseno: 'auto',      // auto | cuadricula | destacado | solo
      nombres: true,       // nombre dentro de cada recuadro
      resaltar: true,      // borde en quien habla
      titulo: '', mostrarTitulo: false,
      banner: '', mostrarBanner: false, desplazar: false,
      cintillo: { visible: false, titulo: '', subtitulo: '' },
      logo: '',
      colorMarca: CFG.colorMarca,
      colorFondo: CFG.colorFondo,
      fondoImagen: '',
      fondoTransparente: false,
      etiquetas: {},       // identidad -> { nombre, cargo } (correcciones del director)
    };
  }

  function normalizarEstado(e) {
    const base = estadoInicial();
    if (!e || typeof e !== 'object') return base;
    const r = Object.assign(base, e);
    r.cintillo = Object.assign(estadoInicial().cintillo, e.cintillo || {});
    if (!Array.isArray(r.enVivo)) r.enVivo = [];
    if (!r.etiquetas || typeof r.etiquetas !== 'object') r.etiquetas = {};
    return r;
  }

  /** Lee el estado publicado por el director en sus atributos. */
  function estadoDeSala(room) {
    if (!room) return null;
    for (const p of room.remoteParticipants.values()) {
      if (p.identity === ID_DIRECTOR && p.attributes && p.attributes.estado) {
        try { return normalizarEstado(JSON.parse(p.attributes.estado)); } catch (e) { return null; }
      }
    }
    return null;
  }

  function esParticipanteDeEscena(p) {
    return p && p.identity !== ID_DIRECTOR && p.identity !== ID_PROGRAMA;
  }

  function nombreDe(p, estado) {
    const et = (estado && estado.etiquetas && estado.etiquetas[p.identity]) || {};
    const meta = leerMeta(p.metadata);
    return {
      nombre: et.nombre || p.name || p.identity,
      cargo: et.cargo != null && et.cargo !== '' ? et.cargo : (meta.cargo || ''),
    };
  }

  /**
   * Arma la lista de "fuentes" (cámaras y pantallas compartidas) a partir
   * de los participantes de la sala. Cada fuente:
   * { clave, identidad, tipo, nombre, cargo, pista, hablando, conectada }
   */
  function fuentesDeSala(room, estado) {
    const LK = window.LivekitClient;
    const mapa = new Map();
    if (!room) return mapa;
    for (const p of room.remoteParticipants.values()) {
      if (!esParticipanteDeEscena(p)) continue;
      const n = nombreDe(p, estado);
      const cam = p.getTrackPublication(LK.Track.Source.Camera);
      mapa.set(p.identity + ':cam', {
        clave: p.identity + ':cam',
        identidad: p.identity,
        tipo: 'camara',
        nombre: n.nombre,
        cargo: n.cargo,
        pista: cam && cam.track && !cam.isMuted ? cam.track : null,
        hablando: !!p.isSpeaking,
      });
      const pan = p.getTrackPublication(LK.Track.Source.ScreenShare);
      if (pan) {
        mapa.set(p.identity + ':pantalla', {
          clave: p.identity + ':pantalla',
          identidad: p.identity,
          tipo: 'pantalla',
          nombre: 'Pantalla de ' + n.nombre,
          cargo: '',
          pista: pan.track && !pan.isMuted ? pan.track : null,
          hablando: false,
        });
      }
    }
    return mapa;
  }

  /* ------------------------------------------------------------ */
  /* Diseños (posición de cada recuadro en 1920x1080)              */
  /* ------------------------------------------------------------ */

  const ANCHO = 1920, ALTO = 1080, SEP = 20, PROP = 16 / 9;

  function areaUtil(estado) {
    const arriba = (estado.mostrarTitulo && estado.titulo) || estado.logo ? 130 : 40;
    const abajo = estado.mostrarBanner && estado.banner ? 120 : 40;
    return { x: 40, y: arriba, w: ANCHO - 80, h: ALTO - arriba - abajo };
  }

  function encajar(w, h) {
    // mayor rectángulo 16:9 que cabe en w x h
    if (w / h > PROP) return { w: h * PROP, h: h };
    return { w: w, h: w / PROP };
  }

  function cuadricula(n, area) {
    let mejor = null;
    for (let cols = 1; cols <= n; cols++) {
      const filas = Math.ceil(n / cols);
      const tw = Math.min((area.w - (cols - 1) * SEP) / cols, ((area.h - (filas - 1) * SEP) / filas) * PROP);
      if (!mejor || tw > mejor.tw) mejor = { cols: cols, filas: filas, tw: tw };
    }
    const tw = mejor.tw;
    // Si sobra alto (por ejemplo, 2 personas lado a lado), los recuadros crecen hacia
    // arriba y abajo hasta ser cuadrados: la cámara se recorta a los lados, como en la TV.
    const altoFila = (area.h - (mejor.filas - 1) * SEP) / mejor.filas;
    const th = Math.max(tw / PROP, Math.min(altoFila, tw));
    const altoTotal = mejor.filas * th + (mejor.filas - 1) * SEP;
    const y0 = area.y + (area.h - altoTotal) / 2;
    const rects = [];
    for (let i = 0; i < n; i++) {
      const fila = Math.floor(i / mejor.cols);
      const enFila = Math.min(mejor.cols, n - fila * mejor.cols);
      const anchoFila = enFila * tw + (enFila - 1) * SEP;
      const x0 = area.x + (area.w - anchoFila) / 2;
      const col = i - fila * mejor.cols;
      rects.push({ x: x0 + col * (tw + SEP), y: y0 + fila * (th + SEP), w: tw, h: th });
    }
    return rects;
  }

  function principalYLateral(k, area) {
    // un recuadro grande y k pequeños en columna a la derecha
    if (k === 0) {
      const t = encajar(area.w, area.h);
      return { principal: { x: area.x + (area.w - t.w) / 2, y: area.y + (area.h - t.h) / 2, w: t.w, h: t.h }, lateral: [] };
    }
    const anchoLat = 440;
    const p = encajar(area.w - anchoLat - SEP, area.h);
    let lh = Math.min(anchoLat / PROP, (area.h - (k - 1) * SEP) / k);
    let lw = lh * PROP;
    const altoCol = k * lh + (k - 1) * SEP;
    const totalW = p.w + SEP + lw;
    const x0 = area.x + (area.w - totalW) / 2;
    const principal = { x: x0, y: area.y + (area.h - p.h) / 2, w: p.w, h: p.h };
    const lateral = [];
    const ly0 = area.y + (area.h - altoCol) / 2;
    for (let i = 0; i < k; i++) lateral.push({ x: x0 + p.w + SEP, y: ly0 + i * (lh + SEP), w: lw, h: lh });
    return { principal: principal, lateral: lateral };
  }

  /** Devuelve [{clave, x, y, w, h, principal}] según el estado y las fuentes conectadas. */
  function calcularDiseno(estado, fuentes) {
    const items = (estado.enVivo || []).filter(function (c) { return fuentes.has(c); });
    if (!items.length) return [];
    const area = areaUtil(estado);
    let modo = estado.diseno || 'auto';
    let principal = estado.destacado && items.indexOf(estado.destacado) >= 0 ? estado.destacado : null;

    if (modo === 'auto') {
      const pantalla = items.find(function (c) { return /:pantalla$/.test(c); });
      if (pantalla) { modo = 'destacado'; principal = principal || pantalla; }
      else modo = 'cuadricula';
    }
    if (modo === 'solo') {
      const c = principal || items[0];
      const r = principalYLateral(0, area).principal;
      return [Object.assign({ clave: c, principal: true }, r)];
    }
    if (modo === 'destacado' && items.length > 1) {
      const c = principal || items.find(function (x) { return /:pantalla$/.test(x); }) || items[0];
      const resto = items.filter(function (x) { return x !== c; });
      const d = principalYLateral(resto.length, area);
      const salida = [Object.assign({ clave: c, principal: true }, d.principal)];
      resto.forEach(function (x, i) { salida.push(Object.assign({ clave: x, principal: false }, d.lateral[i])); });
      return salida;
    }
    return cuadricula(items.length, area).map(function (r, i) {
      return Object.assign({ clave: items[i], principal: items.length === 1 }, r);
    });
  }

  /* ------------------------------------------------------------ */
  /* Escenario: dibuja el programa (OBS) o la vista previa          */
  /* ------------------------------------------------------------ */

  function Escenario(contenedor, opciones) {
    this.opciones = Object.assign({ modo: 'programa' }, opciones || {});
    this.estado = estadoInicial();
    this.fuentes = new Map();
    this.recuadros = new Map();

    this.raiz = crearEl('div', 'esc');
    this.capa = crearEl('div', 'esc-capa');
    this.titulo = crearEl('div', 'esc-titulo');
    this.logo = crearEl('img', 'esc-logo');
    this.logo.alt = '';
    this.logo.addEventListener('error', () => { this.logo.classList.add('oculto'); });
    this.cintillo = crearEl('div', 'esc-cintillo');
    this.ctTitulo = crearEl('div', 'esc-ct-titulo');
    this.ctSub = crearEl('div', 'esc-ct-sub');
    this.cintillo.append(this.ctTitulo, this.ctSub);
    this.banner = crearEl('div', 'esc-banner');
    this.bannerTexto = crearEl('div', 'esc-banner-texto');
    this.banner.append(this.bannerTexto);
    this.raiz.append(this.capa, this.titulo, this.logo, this.cintillo, this.banner);
    contenedor.append(this.raiz);
  }

  Escenario.prototype.actualizar = function (estado, fuentes) {
    if (estado) this.estado = normalizarEstado(estado);
    if (fuentes) this.fuentes = fuentes;
    const e = this.estado;
    const r = this.raiz;

    r.style.setProperty('--marca', e.colorMarca || CFG.colorMarca);
    if (e.fondoTransparente) {
      r.style.background = 'transparent';
    } else if (e.fondoImagen) {
      r.style.background = (e.colorFondo || '#000') + ' url("' + String(e.fondoImagen).replace(/"/g, '%22') + '") center / cover no-repeat';
    } else {
      r.style.background = e.colorFondo || CFG.colorFondo;
    }
    r.classList.toggle('sin-nombres', !e.nombres);

    // Título
    const verTitulo = !!(e.mostrarTitulo && e.titulo);
    this.titulo.textContent = e.titulo || '';
    this.titulo.classList.toggle('visible', verTitulo);

    // Logo
    if (e.logo) {
      if (this.logo.getAttribute('src') !== e.logo) {
        this.logo.classList.remove('oculto');
        this.logo.src = e.logo;
      }
      this.logo.classList.add('visible');
    } else {
      this.logo.classList.remove('visible');
    }

    // Cintillo grande
    const ct = e.cintillo || {};
    const verCt = !!(ct.visible && (ct.titulo || ct.subtitulo));
    if (ct.titulo || ct.subtitulo) {
      this.ctTitulo.textContent = ct.titulo || '';
      this.ctSub.textContent = ct.subtitulo || '';
      this.ctSub.classList.toggle('oculto', !ct.subtitulo);
    }
    this.cintillo.classList.toggle('visible', verCt);

    // Banner inferior
    const verBanner = !!(e.mostrarBanner && e.banner);
    this.bannerTexto.textContent = e.banner || '';
    this.banner.classList.toggle('visible', verBanner);
    this.banner.classList.toggle('desplazar', !!e.desplazar);
    this.cintillo.classList.toggle('con-banner', verBanner);

    this._dibujarRecuadros();
  };

  Escenario.prototype._dibujarRecuadros = function () {
    const diseno = calcularDiseno(this.estado, this.fuentes);
    const activos = new Set();
    const self = this;
    // zona que tapa el cintillo grande (para esconder los nombres pequeños debajo)
    const ct = this.estado.cintillo || {};
    const hayCt = !!(ct.visible && (ct.titulo || ct.subtitulo));
    const abajoCt = ALTO - (this.estado.mostrarBanner && this.estado.banner ? 140 : 70);
    const zonaCt = { x1: 60, x2: 1150, y1: abajoCt - 170, y2: abajoCt };

    diseno.forEach(function (d, orden) {
      const f = self.fuentes.get(d.clave);
      if (!f) return;
      activos.add(d.clave);
      let rec = self.recuadros.get(d.clave);
      if (!rec) {
        rec = self._crearRecuadro(d);
        self.recuadros.set(d.clave, rec);
        self.capa.append(rec.el);
        // aparece con suavidad
        requestAnimationFrame(function () { rec.el.classList.add('visible'); });
      }
      clearTimeout(rec.quitar);
      rec.quitar = null;
      rec.el.classList.add('visible');
      const s = rec.el.style;
      s.left = d.x + 'px'; s.top = d.y + 'px';
      s.width = d.w + 'px'; s.height = d.h + 'px';
      s.zIndex = String(10 + orden);
      rec.el.classList.toggle('pantalla', f.tipo === 'pantalla');
      rec.el.classList.toggle('principal', !!d.principal);
      rec.el.classList.toggle('hablando', !!(self.estado.resaltar && f.hablando));
      rec.nombre.textContent = f.nombre;
      rec.cargo.textContent = f.cargo || '';
      rec.cargo.classList.toggle('oculto', !f.cargo);
      const tapada = hayCt && (d.x + 18) < zonaCt.x2 && (d.x + 420) > zonaCt.x1 &&
        (d.y + d.h - 100) < zonaCt.y2 && (d.y + d.h - 12) > zonaCt.y1;
      rec.etiqueta.classList.toggle('oculto', f.tipo === 'pantalla' || tapada);
      rec.avatar.textContent = iniciales(f.nombre);
      // Video
      if (f.pista !== rec.pista) {
        if (rec.pista) { try { rec.pista.detach(rec.video); } catch (e) { /* nada */ } }
        rec.pista = f.pista;
        if (f.pista) f.pista.attach(rec.video);
      }
      rec.el.classList.toggle('sin-video', !f.pista);
    });

    // Recuadros que salen del aire
    this.recuadros.forEach(function (rec, clave) {
      if (activos.has(clave) || rec.quitar) return;
      rec.el.classList.remove('visible');
      rec.quitar = setTimeout(function () {
        if (rec.pista) { try { rec.pista.detach(rec.video); } catch (e) { /* nada */ } }
        rec.pista = null;
        rec.el.remove();
        self.recuadros.delete(clave);
      }, 450);
    });
  };

  Escenario.prototype._crearRecuadro = function (d) {
    const el = crearEl('div', 'esc-rec');
    el.style.left = d.x + 'px'; el.style.top = d.y + 'px';
    el.style.width = d.w + 'px'; el.style.height = d.h + 'px';
    const video = crearEl('video');
    video.autoplay = true; video.muted = true; video.playsInline = true;
    video.setAttribute('playsinline', '');
    const avatar = crearEl('div', 'esc-avatar');
    const etiqueta = crearEl('div', 'esc-etiqueta');
    const nombre = crearEl('div', 'esc-nombre');
    const cargo = crearEl('div', 'esc-cargo');
    etiqueta.append(nombre, cargo);
    el.append(avatar, video, etiqueta);
    return { el: el, video: video, avatar: avatar, etiqueta: etiqueta, nombre: nombre, cargo: cargo, pista: null, quitar: null };
  };

  /** Ajusta el escenario de 1920x1080 al tamaño del contenedor. */
  function escalarAlContenedor(escenario, contenedor) {
    function ajustar() {
      const w = contenedor.clientWidth, h = contenedor.clientHeight || (w * 9 / 16);
      const k = Math.min(w / ANCHO, h / ALTO);
      escenario.raiz.style.transform = 'scale(' + k + ')';
      escenario.raiz.style.left = ((w - ANCHO * k) / 2) + 'px';
      escenario.raiz.style.top = ((h - ALTO * k) / 2) + 'px';
    }
    ajustar();
    if (window.ResizeObserver) new ResizeObserver(ajustar).observe(contenedor);
    window.addEventListener('resize', ajustar);
    return ajustar;
  }

  /** Opciones de sala recomendadas */
  function opcionesSala(extra) {
    const LK = window.LivekitClient;
    return Object.assign({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { resolution: LK.VideoPresets.h720.resolution },
      publishDefaults: {
        simulcast: true,
        videoSimulcastLayers: [LK.VideoPresets.h180, LK.VideoPresets.h360],
        videoCodec: 'vp8',
        dtx: true,
        red: true,
      },
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    }, extra || {});
  }

  /** Mensaje legible para errores de conexión */
  function mensajeDeError(err) {
    const t = String((err && (err.message || err.reason)) || err || '');
    if (/401|unauthor|invalid token|token is expired|signature|not valid/i.test(t)) return 'El pase no es válido o ya venció.';
    if (/could not establish|failed to fetch|network|websocket|timeout|timed out/i.test(t)) return 'No se pudo conectar con el servidor. Revisa tu internet.';
    if (/NotAllowedError|Permission|denied/i.test(t)) return 'No diste permiso para usar la cámara o el micrófono.';
    if (/NotFoundError|Requested device not found/i.test(t)) return 'No se encontró cámara o micrófono.';
    if (/NotReadableError|Could not start/i.test(t)) return 'La cámara o el micrófono están ocupados por otro programa.';
    return t || 'Ocurrió un error.';
  }

  const TRAZOS = {
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/>',
    micOff: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8M3 3l18 18"/>',
    cam: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
    camOff: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3zM2 3l19 19"/>',
    pantalla: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    salir: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>',
    copiar: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    enviar: '<path d="M21 3L3 10.5l7 2.5 2.5 7z"/><path d="M10 13l11-10"/>',
    estrella: '<path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z"/>',
    cintillo: '<rect x="3" y="12" width="15" height="4" rx="1"/><rect x="3" y="17" width="10" height="3" rx="1"/><path d="M3 5h18M3 8h12"/>',
    editar: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    mensaje: '<path d="M4 5h16v11H9l-5 4z"/>',
    quitar: '<path d="M6 6l12 12M18 6L6 18"/>',
    aire: '<circle cx="12" cy="12" r="3.5" fill="currentColor"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4"/>',
    audifonos: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1"/><rect x="17" y="14" width="4" height="6" rx="1"/>',
    altavoz: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9a4 4 0 0 1 0 6"/>',
    obs: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
    llave: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/>',
    personas: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  };

  function icono(nombre) {
    return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (TRAZOS[nombre] || '') + '</svg>';
  }

  function aviso(texto, tipo, ms) {
    let caja = document.getElementById('avisos');
    if (!caja) { caja = crearEl('div'); caja.id = 'avisos'; document.body.append(caja); }
    const a = crearEl('div', 'aviso ' + (tipo || ''), texto);
    caja.append(a);
    setTimeout(function () { a.classList.add('salir'); }, ms || 4000);
    setTimeout(function () { a.remove(); }, (ms || 4000) + 500);
  }

  window.Sala = {
    CFG: CFG,
    ID_DIRECTOR: ID_DIRECTOR,
    ID_PROGRAMA: ID_PROGRAMA,
    $: $,
    crearEl: crearEl,
    leerLocal: leerLocal,
    guardarLocal: guardarLocal,
    borrarLocal: borrarLocal,
    aleatorio: aleatorio,
    iniciales: iniciales,
    leerMeta: leerMeta,
    debounce: debounce,
    urlBase: urlBase,
    crearToken: crearToken,
    leerToken: leerToken,
    estadoInicial: estadoInicial,
    normalizarEstado: normalizarEstado,
    estadoDeSala: estadoDeSala,
    esParticipanteDeEscena: esParticipanteDeEscena,
    nombreDe: nombreDe,
    fuentesDeSala: fuentesDeSala,
    calcularDiseno: calcularDiseno,
    Escenario: Escenario,
    escalarAlContenedor: escalarAlContenedor,
    opcionesSala: opcionesSala,
    mensajeDeError: mensajeDeError,
    aviso: aviso,
    icono: icono,
  };
})();
