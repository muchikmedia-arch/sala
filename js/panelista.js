/*
 * Sala Muchik - página del panelista
 * El invitado abre su enlace (ya trae su nombre y cargo), activa su cámara y
 * micrófono, y entra a la sala. Siempre entra EN ESPERA: la producción decide
 * cuándo sale al aire. No puede entrar antes de la hora ni si la sala está cerrada.
 */
(function () {
  'use strict';
  const LK = window.LivekitClient;
  const S = window.Sala;
  const $ = function (id) { return document.getElementById(id); };

  $('nombreApp').textContent = S.CFG.nombrePlataforma;
  $('credito').textContent = S.textoCredito();
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
  let previaIniciada = false;
  let medidor = null;
  let bloqueoPantalla = null;
  let saliendo = false;
  let entrando = false;
  let reintentoSala = null;
  let intentosSala = 0;
  let principal = 'yo';   // qué imagen se ve en grande en la sala

  /* ---------------- Vistas ---------------- */

  function mostrar(vista) {
    ['vistaError', 'vistaLobby', 'vistaSala'].forEach(function (v) { $(v).classList.toggle('oculto', v !== vista); });
    document.body.classList.toggle('en-sala', vista === 'vistaSala');
  }

  function error(titulo, texto, reintentar) {
    $('tituloError').textContent = titulo;
    $('textoError').textContent = texto;
    $('btnReintentar').classList.toggle('oculto', !reintentar);
    pintarBarra(null);
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
  const horaEvento = meta.hora ? Number(meta.hora) : 0;           // ms
  const desde = datos.nbf ? datos.nbf * 1000 + 120000 : 0;        // ms (el pase trae 2 min de margen)
  let misDatos = { nombre: datos.name || 'Invitado', cargo: meta.cargo || '' };

  /* ---------------- Fechas en palabras ---------------- */

  function horaTexto(ms) {
    return new Date(ms).toLocaleTimeString('es-PE', { hour: 'numeric', minute: '2-digit' });
  }
  function conPunto(t) { return /\.$/.test(t) ? t : t + '.'; }
  function cuandoTexto(ms) {
    const d = new Date(ms), hoy = new Date();
    const manana = new Date(); manana.setDate(hoy.getDate() + 1);
    const mismoDia = function (a, b) { return a.toDateString() === b.toDateString(); };
    let dia;
    if (mismoDia(d, hoy)) dia = 'hoy';
    else if (mismoDia(d, manana)) dia = 'mañana';
    else dia = 'el ' + d.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });
    return dia + ' a las ' + horaTexto(ms);
  }

  /* ---------------- Barra superior (estado) ---------------- */

  function pintarBarra(tipo, texto) {
    const barra = $('barra'), pill = $('pillEstado'), caja = $('estadoBarra');
    barra.classList.remove('al-aire', 'alerta');
    if (!tipo) { caja.classList.add('oculto'); return; }
    caja.classList.remove('oculto');
    if (tipo === 'aire') {
      barra.classList.add('al-aire');
      pill.className = 'pill aire'; pill.textContent = 'AL AIRE';
    } else if (tipo === 'alerta') {
      barra.classList.add('alerta');
      pill.className = 'pill alerta'; pill.textContent = 'RECONECTANDO';
    } else {
      pill.className = 'pill'; pill.textContent = 'EN ESPERA';
    }
    $('textoEstado').textContent = texto || '';
  }

  /* ---------------- Datos del invitado ---------------- */

  $('saludo').textContent = misDatos.nombre.split(' ')[0] || 'bienvenido/a';
  $('nombreEvento').textContent = nombreEvento;
  $('cuandoEvento').textContent = horaEvento ? ', ' + conPunto(cuandoTexto(horaEvento)) : '.';

  function pintarDatos() {
    $('comoNombre').textContent = misDatos.nombre;
    $('comoCargo').textContent = misDatos.cargo ? ' (' + misDatos.cargo + ')' : '';
  }
  pintarDatos();
  $('btnCambiarDatos').addEventListener('click', function () {
    $('inNombre').value = misDatos.nombre;
    $('inCargo').value = misDatos.cargo;
    $('cajaDatos').classList.toggle('oculto');
  });
  $('btnGuardarDatos').addEventListener('click', function () {
    misDatos = { nombre: $('inNombre').value.trim() || misDatos.nombre, cargo: $('inCargo').value.trim() };
    pintarDatos();
    $('cajaDatos').classList.add('oculto');
  });

  /* ---------------- Botones con ícono ---------------- */

  function pintarBoton(boton, icono, texto, apagado) {
    boton.innerHTML = S.icono(icono) + (texto ? '<span>' + texto + '</span>' : '');
    boton.classList.toggle('apagado', !!apagado);
    if (!texto) boton.title = apagado ? 'Encender' : 'Apagar';
  }

  function pintarPrevios() {
    pintarBoton($('btnPreCam'), camActiva ? 'cam' : 'camOff', '', !camActiva);
    pintarBoton($('btnPreMic'), micActivo ? 'mic' : 'micOff', '', !micActivo);
    $('btnPreCam').disabled = !previaIniciada;
    $('btnPreMic').disabled = !previaIniciada || !pistaAudio;
    $('previaSin').classList.toggle('oculto', !previaIniciada || (camActiva && !!pistaVideo));
  }

  /* ---------------- Antesala: permisos y vista previa ---------------- */

  async function llenarDispositivos() {
    try {
      llenarSelect($('selCam'), await LK.Room.getLocalDevices('videoinput', true), pistaVideo);
      llenarSelect($('selMic'), await LK.Room.getLocalDevices('audioinput', true), pistaAudio);
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
      if (ctx.state === 'suspended') ctx.resume().catch(function () {});
      document.addEventListener('click', function () { if (ctx.state === 'suspended') ctx.resume(); }, { once: true });
      medidor = { parar: function () { activo = false; try { ctx.close(); } catch (e) { /* nada */ } } };
    } catch (e) { /* sin medidor */ }
  }

  function detenerMedidor() {
    if (medidor) { medidor.parar(); medidor = null; }
    $('nivel').style.width = '0%';
  }

  function mostrarCapa(cual) {
    $('capaPermiso').classList.toggle('oculto', cual !== 'permiso');
    $('capaBloqueo').classList.toggle('oculto', cual !== 'bloqueo');
  }

  /** Pide permiso y enciende la vista previa. Devuelve true si hay al menos cámara o micrófono. */
  async function iniciarPrevia() {
    if (previaIniciada) return !!(pistaAudio || pistaVideo);
    $('lobbyError').textContent = '';
    $('btnActivar').disabled = true;
    const opcVideo = { resolution: LK.VideoPresets.h720.resolution, facingMode: 'user' };
    const opcAudio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    let falla = null;
    try {
      const pistas = await LK.createLocalTracks({ audio: opcAudio, video: opcVideo });
      pistas.forEach(function (p) {
        if (p.kind === 'video') pistaVideo = p;
        if (p.kind === 'audio') pistaAudio = p;
      });
    } catch (err) {
      falla = err;
      try { pistaAudio = await LK.createLocalAudioTrack(opcAudio); } catch (e) { pistaAudio = null; }
      try { pistaVideo = await LK.createLocalVideoTrack(opcVideo); } catch (e) { pistaVideo = null; }
    }
    $('btnActivar').disabled = false;
    if (!pistaAudio && !pistaVideo) {
      if (falla && /NotAllowed|Permission|denied/i.test(String(falla.name || falla.message))) mostrarCapa('bloqueo');
      else { mostrarCapa('permiso'); $('lobbyError').textContent = S.mensajeDeError(falla); }
      return false;
    }
    previaIniciada = true;
    mostrarCapa(null);
    if (!pistaVideo) $('lobbyError').textContent = 'No se pudo usar la cámara. Puedes entrar solo con audio.';
    else if (!pistaAudio) $('lobbyError').textContent = 'No se pudo usar el micrófono. Revisa los permisos del navegador.';
    camActiva = !!pistaVideo;
    micActivo = !!pistaAudio;
    if (pistaVideo) pistaVideo.attach($('previa'));
    iniciarMedidor();
    pintarPrevios();
    await llenarDispositivos();
    return true;
  }

  $('btnActivar').addEventListener('click', iniciarPrevia);
  $('btnRecargar').addEventListener('click', function () { location.reload(); });

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

  /* ---------------- Horario: no entrar antes de tiempo ---------------- */

  function esTemprano() { return desde && Date.now() < desde; }

  function pintarHorario() {
    const boton = $('btnEntrar');
    const aviso = $('avisoEntrada');
    if (entrando || reintentoSala) return;
    if (esTemprano()) {
      boton.disabled = true;
      boton.textContent = 'Podrás entrar desde las ' + horaTexto(desde);
      aviso.classList.remove('oculto');
      aviso.textContent = (horaEvento ? conPunto('El evento es ' + cuandoTexto(horaEvento)) + ' ' : '') +
        conPunto('La sala se abre ' + cuandoTexto(desde)) + ' Mientras tanto puedes probar aquí tu cámara y micrófono.';
    } else if (boton.textContent.indexOf('Podrás entrar') === 0) {
      boton.disabled = false;
      boton.textContent = 'Entrar a la sala';
      aviso.classList.add('oculto');
    }
  }
  pintarHorario();
  setInterval(pintarHorario, 15000);

  /* ---------------- Entrar a la sala ---------------- */

  $('btnEntrar').addEventListener('click', entrar);

  function salaCerrada() {
    const aviso = $('avisoEntrada');
    const boton = $('btnEntrar');
    clearTimeout(reintentoSala);
    reintentoSala = null;
    intentosSala++;
    aviso.classList.remove('oculto');
    if (intentosSala > 30) {
      boton.disabled = false;
      boton.textContent = 'Intentar de nuevo';
      aviso.textContent = 'La sala sigue cerrada. Cuando la producción te avise, toca "Intentar de nuevo".';
      return;
    }
    boton.disabled = true;
    boton.textContent = 'Esperando a que abran la sala…';
    aviso.textContent = 'La sala todavía no está abierta. La producción la abrirá en unos minutos y entrarás solo/a. No cierres esta página.';
    const ahora = S.crearEl('button', 'btn chico', 'Intentar ahora');
    ahora.type = 'button';
    ahora.addEventListener('click', function () { clearTimeout(reintentoSala); reintentoSala = null; entrar(); });
    aviso.append(document.createElement('br'), ahora);
    reintentoSala = setTimeout(function esperar() {
      if (document.visibilityState === 'hidden') { reintentoSala = setTimeout(esperar, 5000); return; }
      reintentoSala = null;
      entrar();
    }, 60000);
  }

  async function entrar() {
    if (entrando || esTemprano()) return;
    const boton = $('btnEntrar');
    if (!previaIniciada) {
      boton.disabled = true;
      const ok = await iniciarPrevia();
      boton.disabled = false;
      if (!ok) return;
    }
    entrando = true;
    boton.disabled = true;
    boton.textContent = 'Entrando…';
    $('lobbyError').textContent = '';

    const opc = S.opcionesSala();
    if ($('selCam').value) opc.videoCaptureDefaults = Object.assign({}, opc.videoCaptureDefaults, { deviceId: $('selCam').value });
    if ($('selMic').value) opc.audioCaptureDefaults = Object.assign({}, opc.audioCaptureDefaults, { deviceId: $('selMic').value });
    const r = new LK.Room(opc);
    room = r;
    saliendo = false;

    try {
      await r.connect(S.CFG.livekitUrl, token, { autoSubscribe: false });
    } catch (err) {
      entrando = false;
      room = null;
      boton.disabled = false;
      boton.textContent = 'Entrar a la sala';
      $('lobbyError').textContent = S.mensajeDeError(err);
      return;
    }

    // ¿La producción ya abrió la sala? Si no, salimos enseguida para no gastar.
    if (!r.remoteParticipants.has(S.ID_DIRECTOR)) {
      saliendo = true;
      await r.disconnect(false);
      room = null;
      entrando = false;
      salaCerrada();
      return;
    }
    intentosSala = 0;
    $('avisoEntrada').classList.add('oculto');
    escucharSala(r);

    // Recibir a los demás
    r.remoteParticipants.forEach(function (p) {
      p.trackPublications.forEach(function (pub) { try { pub.setSubscribed(true); } catch (e) { /* nada */ } });
    });

    // Nombre y cargo si los cambió
    try {
      if (misDatos.nombre !== (datos.name || '')) await r.localParticipant.setName(misDatos.nombre);
      if (misDatos.cargo !== (meta.cargo || '')) await r.localParticipant.setMetadata(JSON.stringify(Object.assign({}, meta, { cargo: misDatos.cargo })));
    } catch (e) { /* no crítico */ }

    detenerMedidor();
    try {
      if (pistaAudio) {
        if (!micActivo) await pistaAudio.unmute();
        await r.localParticipant.publishTrack(pistaAudio, { source: LK.Track.Source.Microphone });
        if (!micActivo) await r.localParticipant.setMicrophoneEnabled(false);
      }
      if (pistaVideo) {
        if (camActiva) {
          await r.localParticipant.publishTrack(pistaVideo, { source: LK.Track.Source.Camera, simulcast: true });
        } else {
          pistaVideo.stop();
          pistaVideo = null;
        }
      }
    } catch (err) {
      S.aviso('No se pudo enviar tu cámara o micrófono: ' + S.mensajeDeError(err), 'error', 6000);
    }

    entrando = false;
    mostrar('vistaSala');
    pedirPantallaEncendida();
    actualizarEstado();
    dibujarSala();
    pintarControles();
  }

  /* ---------------- Eventos de la sala ---------------- */

  const audios = new Map(); // sid -> { pista, el }

  function escucharSala(r) {
    const E = LK.RoomEvent;
    let pendiente = false;
    function refrescar() {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(function () {
        pendiente = false;
        dibujarSala();
        actualizarEstado();
        pintarControles();
      });
    }
    [E.ParticipantConnected, E.ParticipantDisconnected, E.TrackSubscribed, E.TrackUnsubscribed,
      E.TrackMuted, E.TrackUnmuted, E.LocalTrackPublished, E.LocalTrackUnpublished,
      E.ParticipantAttributesChanged, E.ParticipantNameChanged, E.ActiveSpeakersChanged,
      E.TrackPublished, E.TrackUnpublished].forEach(function (ev) { r.on(ev, refrescar); });

    r.on(E.TrackPublished, function (pub) { try { pub.setSubscribed(true); } catch (e) { /* nada */ } });

    r.on(E.TrackSubscribed, function (pista, pub) {
      if (pista.kind !== 'audio') return;
      const el = pista.attach();
      el.style.display = 'none';
      document.body.append(el);
      audios.set(pub.trackSid, { pista: pista, el: el });
    });
    r.on(E.TrackUnsubscribed, function (pista, pub) {
      const a = audios.get(pub.trackSid);
      if (!a) return;
      try { a.pista.detach(a.el); } catch (e) { /* nada */ }
      a.el.remove();
      audios.delete(pub.trackSid);
    });

    r.on(E.AudioPlaybackStatusChanged, function () {
      if (!r.canPlaybackAudio) {
        S.aviso('Toca la pantalla para escuchar a los demás', 'mensaje', 5000);
        document.addEventListener('click', function () { r.startAudio(); }, { once: true });
      }
    });

    r.on(E.DataReceived, function (carga, participante, tipo, tema) {
      if (!participante || participante.identity !== S.ID_DIRECTOR || tema !== 'sala') return;
      let m = null;
      try { m = JSON.parse(new TextDecoder().decode(carga)); } catch (e) { return; }
      if (m.accion === 'silenciar') {
        r.localParticipant.setMicrophoneEnabled(false).then(pintarControles);
        S.aviso('La producción silenció tu micrófono', 'mensaje', 5000);
      } else if (m.accion === 'mensaje' && m.texto) {
        S.aviso('Producción: ' + m.texto, 'mensaje', 12000);
      } else if (m.accion === 'salir') {
        salirDeLaSala();
        error('Saliste de la sala', 'La producción terminó tu participación. ¡Gracias!');
      } else if (m.accion === 'terminar') {
        salirDeLaSala();
        error('El evento terminó', '¡Gracias por participar!');
      }
    });

    r.on(E.ConnectionQualityChanged, function (calidad, participante) {
      if (participante !== r.localParticipant) return;
      if (calidad === LK.ConnectionQuality.Poor) S.aviso('Tu conexión está débil. Si puedes, acércate al WiFi.', 'mensaje', 5000);
    });

    r.on(E.Reconnecting, function () { pintarBarra('alerta', 'Reconectando… no cierres esta página'); });
    r.on(E.Reconnected, actualizarEstado);

    r.on(E.Disconnected, function (motivo) {
      apagarCamaraYMicro();
      soltarPantallaEncendida();
      if (saliendo) return;
      const DR = LK.DisconnectReason;
      if (motivo === DR.PARTICIPANT_REMOVED) {
        error('Saliste de la sala', 'La producción terminó tu participación. ¡Gracias!');
      } else if (motivo === DR.DUPLICATE_IDENTITY) {
        error('Entraste desde otro lugar', 'Este enlace se abrió en otro dispositivo o pestaña. Usa solo uno a la vez.', true);
      } else if (motivo === DR.ROOM_DELETED || motivo === DR.ROOM_CLOSED) {
        error('El evento terminó', '¡Gracias por participar!');
      } else if (motivo !== DR.CLIENT_INITIATED) {
        error('Se cortó la conexión', 'Revisa tu internet y vuelve a entrar con el mismo enlace.', true);
      }
    });
  }

  /* ---------------- Estado: ¿estoy al aire? ---------------- */

  function actualizarEstado() {
    if (!room || saliendo || room.state === 'disconnected' || room.state === 'reconnecting') return;
    const estado = S.estadoDeSala(room);
    const enVivo = estado ? estado.enVivo : [];
    const camAire = enVivo.indexOf(miIdentidad + ':cam') >= 0;
    const pantallaAire = enVivo.indexOf(miIdentidad + ':pantalla') >= 0;
    if (camAire) pintarBarra('aire', 'Todos te ven y te escuchan');
    else if (pantallaAire) pintarBarra('aire', 'Tu pantalla está al aire');
    else pintarBarra('espera', 'La producción te pondrá al aire');
  }

  /* ---------------- Sala: tu imagen grande, los demás pequeños ---------------- */

  const tiles = new Map(); // clave -> { el, video, ... }

  function itemsDeSala() {
    const estado = S.estadoDeSala(room);
    const enVivo = estado ? estado.enVivo : [];
    const lista = [];
    const yo = room.localParticipant;
    const miCam = yo.getTrackPublication(LK.Track.Source.Camera);
    lista.push({
      clave: 'yo', nombre: 'Tú', yo: true,
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
    return lista;
  }

  function crearTile(clave) {
    const el = S.crearEl('div', 'tile');
    const ini = S.crearEl('div', 'iniciales');
    const video = document.createElement('video');
    video.autoplay = true; video.muted = true; video.playsInline = true;
    const rotulo = S.crearEl('div', 'rotulo');
    const aire = S.crearEl('div', 'marca-aire', 'AL AIRE');
    const volver = S.crearEl('div', 'volver oculto', 'Toca para volver a verte');
    el.append(ini, video, rotulo, aire, volver);
    el.addEventListener('click', function () {
      // tocar una imagen pequeña la pone en grande; tocar la grande vuelve a ti
      principal = principal === clave ? 'yo' : clave;
      dibujarSala();
    });
    return { el: el, video: video, ini: ini, rotulo: rotulo, aire: aire, volver: volver, pista: null };
  }

  function dibujarSala() {
    if (!room || saliendo) return;
    const lista = itemsDeSala();
    if (!lista.some(function (x) { return x.clave === principal; })) principal = 'yo';
    const cajaP = $('principal'), tira = $('tira');
    const vigentes = new Set();
    let enTira = 0;
    lista.forEach(function (item) {
      vigentes.add(item.clave);
      let t = tiles.get(item.clave);
      if (!t) { t = crearTile(item.clave); tiles.set(item.clave, t); }
      const grande = item.clave === principal;
      const destino = grande ? cajaP : tira;
      const pos = grande ? 0 : enTira++;
      if (destino.children[pos] !== t.el) {
        destino.insertBefore(t.el, destino.children[pos] || null);
        t.video.play().catch(function () {});
      }
      t.el.classList.toggle('yo', !!item.yo);
      t.el.classList.toggle('pantalla', !!item.pantalla);
      t.el.classList.toggle('hablando', !!item.hablando);
      t.el.classList.toggle('con-video', !!item.pista);
      t.ini.textContent = item.yo ? S.iniciales(misDatos.nombre) : S.iniciales(item.nombre);
      t.rotulo.innerHTML = (item.micOff ? S.icono('micOff') : '') + '<span></span>';
      t.rotulo.lastChild.textContent = item.nombre;
      t.aire.classList.toggle('oculto', !item.aire);
      t.volver.classList.toggle('oculto', !(grande && !item.yo));
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
  }

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
    pintarControles(); dibujarSala();
  });

  $('btnCam').addEventListener('click', async function () {
    try { await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled); }
    catch (e) { S.aviso(S.mensajeDeError(e), 'error'); }
    pintarControles(); dibujarSala();
  });

  $('btnPantalla').addEventListener('click', async function () {
    const activa = room.localParticipant.isScreenShareEnabled;
    try {
      // El navegador deja elegir: una pestaña, una ventana (PowerPoint, PDF...) o la pantalla completa
      await room.localParticipant.setScreenShareEnabled(!activa, {
        audio: true,
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        systemAudio: 'include',
        contentHint: 'detail',
        resolution: { width: 1920, height: 1080, frameRate: 15 },
      });
      if (!activa) S.aviso('Compartiendo. La producción decide cuándo sale al aire.', 'ok', 5000);
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

  /** Apaga cámara, micrófono y pantalla compartida para que el equipo las libere. */
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
  (async function () {
    // Si ya dio permiso antes, se enciende sola; si no, mostramos el botón grande.
    let estadoCam = 'prompt', estadoMic = 'prompt';
    try {
      estadoCam = (await navigator.permissions.query({ name: 'camera' })).state;
      estadoMic = (await navigator.permissions.query({ name: 'microphone' })).state;
    } catch (e) { /* el navegador no lo informa */ }
    if (estadoCam === 'granted' && estadoMic === 'granted') iniciarPrevia();
    else if (estadoCam === 'denied' && estadoMic === 'denied') mostrarCapa('bloqueo');
    else mostrarCapa('permiso');
  })();
})();
