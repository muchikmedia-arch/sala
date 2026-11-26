/*
 * Sala Muchik - página del panelista
 * El invitado abre su enlace, prueba cámara y micrófono y entra a la sala.
 */
(function () {
  'use strict';
  const LK = window.LivekitClient;
  const S = window.Sala;
  const $ = function (id) { return document.getElementById(id); };

  $('nombreApp').textContent = S.CFG.nombrePlataforma;
  $('credito').textContent = 'Desarrollado por ' + S.CFG.credito;
  document.title = S.CFG.nombrePlataforma;
  $('icoAudifonos').innerHTML = S.icono('audifonos');

  const params = new URLSearchParams(location.search);
  const token = params.get('t') || '';
  const datos = S.leerToken(token);

  let room = null;
  let pistaVideo = null;
  let pistaAudio = null;
  let camActiva = true;
  let micActivo = true;
  let medidor = null;
  let bloqueoPantalla = null;
  let saliendo = false;

  /* ---------------- Vistas ---------------- */

  function mostrar(vista) {
    ['vistaError', 'vistaLobby', 'vistaSala'].forEach(function (v) { $(v).classList.toggle('oculto', v !== vista); });
  }

  function error(titulo, texto, reintentar) {
    $('tituloError').textContent = titulo;
    $('textoError').textContent = texto;
    $('btnReintentar').classList.toggle('oculto', !reintentar);
    $('pillEstado').classList.add('oculto');
    mostrar('vistaError');
  }

  $('btnReintentar').addEventListener('click', function () { location.reload(); });

  if (!token || !datos || !datos.video || !datos.video.room) {
    error('Enlace incompleto', 'El enlace que abriste no está completo. Pide a la producción que te lo envíe de nuevo y ábrelo completo.');
    return;
  }
  if (datos.exp && datos.exp * 1000 < Date.now()) {
    error('Este enlace ya venció', 'Pide a la producción un enlace nuevo.');
    return;
  }

  const meta = S.leerMeta(datos.metadata);
  const miIdentidad = datos.sub;
  const nombreEvento = meta.evento || datos.video.room.replace(/[-_]+/g, ' ');

  $('saludo').textContent = (datos.name || '').split(' ')[0] || 'bienvenido/a';
  $('nombreEvento').textContent = nombreEvento;
  $('inNombre').value = datos.name || '';
  $('inCargo').value = meta.cargo || '';

  /* ---------------- Botones con ícono ---------------- */

  function pintarBoton(boton, icono, texto, apagado) {
    boton.innerHTML = S.icono(icono) + '<span>' + texto + '</span>';
    boton.classList.toggle('apagado', !!apagado);
  }

  function pintarPrevios() {
    pintarBoton($('btnPreCam'), camActiva ? 'cam' : 'camOff', camActiva ? 'Apagar cámara' : 'Encender cámara', !camActiva);
    pintarBoton($('btnPreMic'), micActivo ? 'mic' : 'micOff', micActivo ? 'Silenciar micrófono' : 'Activar micrófono', !micActivo);
    $('previaSin').classList.toggle('oculto', camActiva && !!pistaVideo);
  }

  /* ---------------- Antesala ---------------- */

  async function llenarDispositivos() {
    try {
      const cams = await LK.Room.getLocalDevices('videoinput', true);
      const mics = await LK.Room.getLocalDevices('audioinput', true);
      llenarSelect($('selCam'), cams, pistaVideo);
      llenarSelect($('selMic'), mics, pistaAudio);
    } catch (e) { /* sin lista */ }
  }

  function llenarSelect(sel, lista, pista) {
    sel.innerHTML = '';
    if (!lista.length) {
      const o = document.createElement('option'); o.textContent = 'No se encontró'; o.value = '';
      sel.append(o); sel.disabled = true; return;
    }
    sel.disabled = false;
    let actual = '';
    try { actual = pista && pista.mediaStreamTrack ? pista.mediaStreamTrack.getSettings().deviceId : ''; } catch (e) { actual = ''; }
    lista.forEach(function (d, i) {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || ('Dispositivo ' + (i + 1));
      if (d.deviceId === actual) o.selected = true;
      sel.append(o);
    });
  }

  function iniciarMedidor() {
    detenerMedidor();
    if (!pistaAudio || !pistaAudio.mediaStreamTrack) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const fuente = ctx.createMediaStreamSource(new MediaStream([pistaAudio.mediaStreamTrack]));
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      fuente.connect(an);
      const buf = new Uint8Array(an.fftSize);
      let activo = true;
      (function ciclo() {
        if (!activo) return;
        an.getByteTimeDomainData(buf);
        let suma = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; suma += v * v; }
        const nivel = Math.min(1, Math.sqrt(suma / buf.length) * 4);
        $('nivel').style.width = (micActivo ? nivel * 100 : 0) + '%';
        requestAnimationFrame(ciclo);
      })();
      document.addEventListener('click', function () { if (ctx.state === 'suspended') ctx.resume(); }, { once: true });
      medidor = { parar: function () { activo = false; try { ctx.close(); } catch (e) { /* nada */ } } };
    } catch (e) { /* sin medidor */ }
  }

  function detenerMedidor() {
    if (medidor) { medidor.parar(); medidor = null; }
    $('nivel').style.width = '0%';
  }

  async function iniciarPrevia() {
    $('lobbyError').textContent = '';
    const opcVideo = { resolution: LK.VideoPresets.h720.resolution, facingMode: 'user' };
    const opcAudio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    try {
      const pistas = await LK.createLocalTracks({ audio: opcAudio, video: opcVideo });
      pistas.forEach(function (p) {
        if (p.kind === 'video') pistaVideo = p;
        if (p.kind === 'audio') pistaAudio = p;
      });
    } catch (err) {
      // Intentar por separado (por ejemplo, si no hay cámara)
      try { pistaAudio = await LK.createLocalAudioTrack(opcAudio); } catch (e) { pistaAudio = null; }
      try { pistaVideo = await LK.createLocalVideoTrack(opcVideo); } catch (e) { pistaVideo = null; }
      if (!pistaAudio && !pistaVideo) {
        $('lobbyError').textContent = S.mensajeDeError(err) + ' Toca el candado junto a la dirección del navegador y permite cámara y micrófono, luego recarga la página.';
      } else if (!pistaVideo) {
        $('lobbyError').textContent = 'No se pudo usar la cámara. Puedes entrar solo con audio.';
      } else if (!pistaAudio) {
        $('lobbyError').textContent = 'No se pudo usar el micrófono. Revisa los permisos del navegador.';
      }
    }
    camActiva = !!pistaVideo;
    micActivo = !!pistaAudio;
    if (pistaVideo) pistaVideo.attach($('previa'));
    iniciarMedidor();
    pintarPrevios();
    await llenarDispositivos();
  }

  $('selCam').addEventListener('change', async function () {
    if (!this.value) return;
    try {
      if (pistaVideo) await pistaVideo.setDeviceId(this.value);
      else {
        pistaVideo = await LK.createLocalVideoTrack({ deviceId: this.value, resolution: LK.VideoPresets.h720.resolution });
        pistaVideo.attach($('previa'));
        camActiva = true;
      }
      pintarPrevios();
    } catch (e) { $('lobbyError').textContent = S.mensajeDeError(e); }
  });

  $('selMic').addEventListener('change', async function () {
    if (!this.value) return;
    try {
      if (pistaAudio) await pistaAudio.setDeviceId(this.value);
      else {
        pistaAudio = await LK.createLocalAudioTrack({ deviceId: this.value, echoCancellation: true, noiseSuppression: true, autoGainControl: true });
        micActivo = true;
      }
      iniciarMedidor();
      pintarPrevios();
    } catch (e) { $('lobbyError').textContent = S.mensajeDeError(e); }
  });

  $('btnPreCam').addEventListener('click', async function () {
    if (!pistaVideo) {
      try {
        pistaVideo = await LK.createLocalVideoTrack({ resolution: LK.VideoPresets.h720.resolution, facingMode: 'user' });
        pistaVideo.attach($('previa'));
        camActiva = true;
        await llenarDispositivos();
      } catch (e) { $('lobbyError').textContent = S.mensajeDeError(e); }
    } else if (camActiva) {
      await pistaVideo.mute(); camActiva = false;
    } else {
      await pistaVideo.unmute(); camActiva = true;
    }
    pintarPrevios();
  });

  $('btnPreMic').addEventListener('click', async function () {
    if (!pistaAudio) return;
    if (micActivo) { await pistaAudio.mute(); micActivo = false; }
    else { await pistaAudio.unmute(); micActivo = true; }
    pintarPrevios();
  });

  /* ---------------- Entrar a la sala ---------------- */

  $('btnEntrar').addEventListener('click', entrar);

  async function entrar() {
    const boton = $('btnEntrar');
    boton.disabled = true;
    boton.textContent = 'Entrando…';
    $('lobbyError').textContent = '';

    const nombre = $('inNombre').value.trim() || datos.name || 'Invitado';
    const cargo = $('inCargo').value.trim();

    const opc = S.opcionesSala();
    if ($('selCam').value) opc.videoCaptureDefaults = Object.assign({}, opc.videoCaptureDefaults, { deviceId: $('selCam').value });
    if ($('selMic').value) opc.audioCaptureDefaults = Object.assign({}, opc.audioCaptureDefaults, { deviceId: $('selMic').value });
    room = new LK.Room(opc);
    escucharSala();

    try {
      await room.connect(S.CFG.livekitUrl, token);
    } catch (err) {
      boton.disabled = false;
      boton.textContent = 'Entrar a la sala';
      $('lobbyError').textContent = S.mensajeDeError(err);
      room = null;
      return;
    }

    // Actualizar nombre y cargo si los cambió
    try {
      if (nombre !== (datos.name || '')) await room.localParticipant.setName(nombre);
      if (cargo !== (meta.cargo || '')) await room.localParticipant.setMetadata(JSON.stringify(Object.assign({}, meta, { cargo: cargo })));
    } catch (e) { /* no crítico */ }

    detenerMedidor();
    try {
      if (pistaAudio) {
        if (!micActivo) await pistaAudio.unmute();
        await room.localParticipant.publishTrack(pistaAudio, { source: LK.Track.Source.Microphone });
        if (!micActivo) await room.localParticipant.setMicrophoneEnabled(false);
      }
      if (pistaVideo) {
        if (camActiva) {
          await room.localParticipant.publishTrack(pistaVideo, { source: LK.Track.Source.Camera, simulcast: true });
        } else {
          pistaVideo.stop();
          pistaVideo = null;
        }
      }
    } catch (err) {
      S.aviso('No se pudo enviar tu cámara o micrófono: ' + S.mensajeDeError(err), 'error', 6000);
    }

    mostrar('vistaSala');
    $('pillEstado').classList.remove('oculto');
    pedirPantallaEncendida();
    actualizarEstado();
    dibujarRejilla();
    pintarControles();
  }

  /* ---------------- Eventos de la sala ---------------- */

  const audios = new Map(); // sid -> elemento

  function escucharSala() {
    const E = LK.RoomEvent;
    let pendiente = false;
    function refrescar() {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(function () {
        pendiente = false;
        dibujarRejilla();
        actualizarEstado();
        pintarControles();
      });
    }
    [E.ParticipantConnected, E.ParticipantDisconnected, E.TrackSubscribed, E.TrackUnsubscribed,
      E.TrackMuted, E.TrackUnmuted, E.LocalTrackPublished, E.LocalTrackUnpublished,
      E.ParticipantAttributesChanged, E.ParticipantNameChanged, E.ActiveSpeakersChanged,
      E.TrackPublished, E.TrackUnpublished].forEach(function (ev) { room.on(ev, refrescar); });

    room.on(E.TrackSubscribed, function (pista, pub) {
      if (pista.kind !== 'audio') return;
      const el = pista.attach();
      el.style.display = 'none';
      document.body.append(el);
      audios.set(pub.trackSid, { pista: pista, el: el });
    });
    room.on(E.TrackUnsubscribed, function (pista, pub) {
      const a = audios.get(pub.trackSid);
      if (!a) return;
      try { a.pista.detach(a.el); } catch (e) { /* nada */ }
      a.el.remove();
      audios.delete(pub.trackSid);
    });

    room.on(E.AudioPlaybackStatusChanged, function () {
      if (!room.canPlaybackAudio) {
        S.aviso('Toca la pantalla para escuchar a los demás', 'mensaje', 5000);
        document.addEventListener('click', function () { room.startAudio(); }, { once: true });
      }
    });

    room.on(E.DataReceived, function (carga, participante, tipo, tema) {
      if (!participante || participante.identity !== S.ID_DIRECTOR || tema !== 'sala') return;
      let m = null;
      try { m = JSON.parse(new TextDecoder().decode(carga)); } catch (e) { return; }
      if (m.accion === 'silenciar') {
        room.localParticipant.setMicrophoneEnabled(false).then(pintarControles);
        S.aviso('La producción silenció tu micrófono', 'mensaje', 5000);
      } else if (m.accion === 'mensaje' && m.texto) {
        S.aviso('Producción: ' + m.texto, 'mensaje', 12000);
      } else if (m.accion === 'salir') {
        salirDeLaSala();
        error('Saliste de la sala', 'La producción terminó tu participación. ¡Gracias!');
      }
    });

    room.on(E.ConnectionQualityChanged, function (calidad, participante) {
      if (participante !== room.localParticipant) return;
      if (calidad === LK.ConnectionQuality.Poor) S.aviso('Tu conexión está débil. Si puedes, acércate al WiFi.', 'mensaje', 5000);
    });

    room.on(E.Reconnecting, function () {
      $('franja').className = 'franja alerta';
      $('franja').textContent = 'Reconectando… no cierres esta página.';
    });
    room.on(E.Reconnected, actualizarEstado);

    room.on(E.Disconnected, function (motivo) {
      apagarCamaraYMicro();
      soltarPantallaEncendida();
      if (saliendo) return;
      if (motivo === LK.DisconnectReason.PARTICIPANT_REMOVED) {
        error('Saliste de la sala', 'La producción terminó tu participación. ¡Gracias!');
      } else if (motivo === LK.DisconnectReason.DUPLICATE_IDENTITY) {
        error('Entraste desde otro lugar', 'Este enlace se abrió en otro dispositivo o pestaña. Usa solo uno a la vez.', true);
      } else if (motivo === LK.DisconnectReason.ROOM_DELETED || motivo === LK.DisconnectReason.ROOM_CLOSED) {
        error('La sala se cerró', 'El evento terminó. ¡Gracias por participar!');
      } else if (motivo !== LK.DisconnectReason.CLIENT_INITIATED) {
        error('Se cortó la conexión', 'Revisa tu internet y vuelve a entrar con el mismo enlace.', true);
      }
    });
  }

  /* ---------------- Estado: ¿estoy al aire? ---------------- */

  function actualizarEstado() {
    if (!room || saliendo || room.state === 'disconnected') return;
    const estado = S.estadoDeSala(room);
    const enVivo = estado ? estado.enVivo : [];
    const camAire = enVivo.indexOf(miIdentidad + ':cam') >= 0;
    const pantallaAire = enVivo.indexOf(miIdentidad + ':pantalla') >= 0;
    const pill = $('pillEstado');
    const franja = $('franja');
    if (camAire || pantallaAire) {
      pill.className = 'pill aire'; pill.textContent = 'AL AIRE';
      franja.className = 'franja aire';
      franja.textContent = camAire ? 'Estás al aire: todos te ven y te escuchan.' : 'Tu pantalla está al aire.';
    } else {
      pill.className = 'pill'; pill.textContent = 'EN ESPERA';
      franja.className = 'franja';
      franja.textContent = 'En espera: la producción te pondrá al aire cuando sea tu turno. Los demás panelistas sí te escuchan.';
    }
  }

  /* ---------------- Rejilla de participantes ---------------- */

  const tiles = new Map(); // clave -> { el, video, pista }

  function dibujarRejilla() {
    if (!room || saliendo) return;
    const rejilla = $('rejilla');
    const estado = S.estadoDeSala(room);
    const enVivo = estado ? estado.enVivo : [];
    const lista = [];

    // Yo
    const yo = room.localParticipant;
    const miCam = yo.getTrackPublication(LK.Track.Source.Camera);
    lista.push({
      clave: 'yo', nombre: (yo.name || 'Tú') + ' (tú)', yo: true,
      pista: miCam && miCam.track && !miCam.isMuted ? miCam.track : null,
      micOff: !yo.isMicrophoneEnabled, hablando: yo.isSpeaking,
      aire: enVivo.indexOf(miIdentidad + ':cam') >= 0,
    });

    room.remoteParticipants.forEach(function (p) {
      if (p.identity === S.ID_PROGRAMA) return;
      const esDirector = p.identity === S.ID_DIRECTOR;
      const cam = p.getTrackPublication(LK.Track.Source.Camera);
      const conVideo = cam && cam.track && !cam.isMuted;
      if (esDirector && !conVideo) return; // la producción solo se escucha
      const n = S.nombreDe(p, estado);
      lista.push({
        clave: p.identity + ':cam',
        nombre: esDirector ? 'Producción' : n.nombre,
        pista: conVideo ? cam.track : null,
        micOff: !p.isMicrophoneEnabled, hablando: p.isSpeaking,
        aire: enVivo.indexOf(p.identity + ':cam') >= 0,
      });
      const pan = p.getTrackPublication(LK.Track.Source.ScreenShare);
      if (pan && pan.track) {
        lista.push({
          clave: p.identity + ':pantalla', nombre: 'Pantalla de ' + n.nombre, pantalla: true,
          pista: pan.track, aire: enVivo.indexOf(p.identity + ':pantalla') >= 0,
        });
      }
    });

    const vigentes = new Set();
    lista.forEach(function (item, i) {
      vigentes.add(item.clave);
      let t = tiles.get(item.clave);
      if (!t) {
        const el = S.crearEl('div', 'tile');
        const ini = S.crearEl('div', 'iniciales');
        const video = document.createElement('video');
        video.autoplay = true; video.muted = true; video.playsInline = true;
        const rotulo = S.crearEl('div', 'rotulo');
        const aire = S.crearEl('div', 'marca-aire', 'AL AIRE');
        el.append(ini, video, rotulo, aire);
        t = { el: el, video: video, ini: ini, rotulo: rotulo, aire: aire, pista: null };
        tiles.set(item.clave, t);
      }
      if (rejilla.children[i] !== t.el) rejilla.insertBefore(t.el, rejilla.children[i] || null);
      t.el.classList.toggle('yo', !!item.yo);
      t.el.classList.toggle('pantalla', !!item.pantalla);
      t.el.classList.toggle('hablando', !!item.hablando);
      t.el.classList.toggle('con-video', !!item.pista);
      t.ini.textContent = S.iniciales(item.nombre.replace(' (tú)', ''));
      t.rotulo.innerHTML = (item.micOff ? S.icono('micOff') : '') + '<span></span>';
      t.rotulo.lastChild.textContent = item.nombre;
      t.aire.classList.toggle('oculto', !item.aire);
      if (item.pista !== t.pista) {
        if (t.pista) { try { t.pista.detach(t.video); } catch (e) { /* nada */ } }
        t.pista = item.pista;
        if (item.pista) item.pista.attach(t.video);
      }
    });
    tiles.forEach(function (t, clave) {
      if (vigentes.has(clave)) return;
      if (t.pista) { try { t.pista.detach(t.video); } catch (e) { /* nada */ } }
      t.el.remove();
      tiles.delete(clave);
    });
    ajustarRejilla();
  }

  /** Elige cuántas columnas usar para que los videos se vean lo más grandes posible. */
  function ajustarRejilla() {
    const rejilla = $('rejilla');
    const n = rejilla.children.length;
    if (!n) return;
    const sep = 12;
    const ancho = rejilla.clientWidth;
    const alto = Math.max(200, window.innerHeight - rejilla.getBoundingClientRect().top - 110);
    let mejor = { cols: 1, tw: 0 };
    for (let cols = 1; cols <= n; cols++) {
      const filas = Math.ceil(n / cols);
      const tw = Math.min((ancho - (cols - 1) * sep) / cols, ((alto - (filas - 1) * sep) / filas) * 16 / 9);
      if (tw > mejor.tw) mejor = { cols: cols, tw: tw };
    }
    const tw = Math.max(140, Math.floor(mejor.tw));
    rejilla.style.gridTemplateColumns = 'repeat(' + mejor.cols + ', ' + tw + 'px)';
  }
  window.addEventListener('resize', ajustarRejilla);

  /* ---------------- Controles ---------------- */

  const puedeCompartir = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!puedeCompartir) $('btnPantalla').classList.add('oculto');

  function pintarControles() {
    if (!room || saliendo) return;
    const lp = room.localParticipant;
    const mic = lp.isMicrophoneEnabled, cam = lp.isCameraEnabled, pan = lp.isScreenShareEnabled;
    pintarBoton($('btnMic'), mic ? 'mic' : 'micOff', mic ? 'Micrófono' : 'Silenciado', !mic);
    pintarBoton($('btnCam'), cam ? 'cam' : 'camOff', cam ? 'Cámara' : 'Sin cámara', !cam);
    pintarBoton($('btnPantalla'), 'pantalla', pan ? 'Dejar de compartir' : 'Compartir pantalla');
    $('btnPantalla').classList.toggle('activo', pan);
    pintarBoton($('btnSalir'), 'salir', 'Salir');
  }

  $('btnMic').addEventListener('click', async function () {
    try { await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled); }
    catch (e) { S.aviso(S.mensajeDeError(e), 'error'); }
    pintarControles(); dibujarRejilla();
  });

  $('btnCam').addEventListener('click', async function () {
    try { await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled); }
    catch (e) { S.aviso(S.mensajeDeError(e), 'error'); }
    pintarControles(); dibujarRejilla();
  });

  $('btnPantalla').addEventListener('click', async function () {
    const activa = room.localParticipant.isScreenShareEnabled;
    try {
      await room.localParticipant.setScreenShareEnabled(!activa, { audio: true, selfBrowserSurface: 'exclude' });
      if (!activa) S.aviso('Compartiendo pantalla. La producción decide cuándo sale al aire.', 'ok', 5000);
    } catch (e) {
      if (!/NotAllowed|Permission|cancel/i.test(String(e && e.message))) S.aviso(S.mensajeDeError(e), 'error');
    }
    pintarControles();
  });

  $('btnSalir').addEventListener('click', function () {
    if (!confirm('¿Seguro que quieres salir de la sala?')) return;
    salirDeLaSala();
    error('Saliste de la sala', 'Puedes volver a entrar con el mismo enlace mientras siga vigente.', true);
    $('btnReintentar').textContent = 'Volver a entrar';
  });

  /** Apaga cámara, micrófono y pantalla compartida para que el celular las libere. */
  function apagarCamaraYMicro() {
    if (room) {
      room.localParticipant.trackPublications.forEach(function (pub) {
        try { if (pub.track) pub.track.stop(); } catch (e) { /* nada */ }
      });
    }
    [pistaVideo, pistaAudio].forEach(function (p) {
      try { if (p) p.stop(); } catch (e) { /* nada */ }
    });
    pistaVideo = null; pistaAudio = null;
    detenerMedidor();
  }

  /** Sale de la sala y suelta todo: ya no queda nada conectado ni usando la cámara. */
  function salirDeLaSala() {
    saliendo = true;
    apagarCamaraYMicro();
    try { if (room) room.disconnect(true); } catch (e) { /* nada */ }
    soltarPantallaEncendida();
  }

  /* ---------------- Mantener la pantalla encendida (celulares) ---------------- */

  async function pedirPantallaEncendida() {
    try { if ('wakeLock' in navigator) bloqueoPantalla = await navigator.wakeLock.request('screen'); } catch (e) { /* nada */ }
  }
  function soltarPantallaEncendida() {
    try { if (bloqueoPantalla) bloqueoPantalla.release(); } catch (e) { /* nada */ }
    bloqueoPantalla = null;
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && room && room.state === 'connected') pedirPantallaEncendida();
  });

  window.addEventListener('beforeunload', function () { if (room) room.disconnect(); });

  /* ---------------- Inicio ---------------- */
  mostrar('vistaLobby');
  pintarPrevios();
  iniciarPrevia();
})();
