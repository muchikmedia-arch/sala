/*
 * Sala Muchik - página de programa (fuente de navegador en OBS)
 * Entra a la sala como espectador invisible y dibuja lo que manda el director.
 */
(function () {
  'use strict';
  const LK = window.LivekitClient;
  const S = window.Sala;

  const lienzo = document.getElementById('lienzo');
  const nota = document.getElementById('nota');
  const botonAudio = document.getElementById('activarAudio');

  const escenario = new S.Escenario(lienzo, { modo: 'programa' });
  S.escalarAlContenedor(escenario, lienzo);

  const params = new URLSearchParams(location.search);
  const token = params.get('t') || '';
  const datos = S.leerToken(token);
  const sala = datos && datos.video ? datos.video.room : '';
  const claveCache = 'sala.programa.estado.' + sala;

  let estado = S.normalizarEstado(S.leerLocal(claveCache, null));
  let room = null;
  let reintento = null;
  const audios = new Map(); // clave -> { pista, el }

  function mostrarNota(texto) {
    nota.textContent = texto;
    nota.classList.toggle('oculto', !texto);
  }

  escenario.actualizar(estado, new Map());

  if (!token || !datos) {
    mostrarNota('Falta el enlace de OBS. Cópialo desde el panel del director (botón "Enlace para OBS").');
    return;
  }
  if (datos.exp && datos.exp * 1000 < Date.now()) {
    mostrarNota('Este enlace de OBS ya venció. Genera uno nuevo en el panel del director.');
    return;
  }

  /* ---------------- Dibujo ---------------- */

  let pendiente = false;
  function refrescar() {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(function () {
      pendiente = false;
      const nuevo = S.estadoDeSala(room);
      if (nuevo) {
        estado = nuevo;
        S.guardarLocal(claveCache, estado);
      }
      const fuentes = S.fuentesDeSala(room, estado);
      escenario.actualizar(estado, fuentes);
      actualizarAudio(fuentes);
    });
  }

  /* ---------------- Audio: solo de quienes están al aire ---------------- */

  function pistaDeAudio(clave) {
    if (!room) return null;
    const partes = clave.split(':');
    const p = room.remoteParticipants.get(partes[0]);
    if (!p) return null;
    const fuente = partes[1] === 'pantalla' ? LK.Track.Source.ScreenShareAudio : LK.Track.Source.Microphone;
    const pub = p.getTrackPublication(fuente);
    return pub && pub.track ? pub.track : null;
  }

  function actualizarAudio(fuentes) {
    const deseadas = new Map();
    (estado.enVivo || []).forEach(function (clave) {
      if (!fuentes.has(clave)) return;
      const pista = pistaDeAudio(clave);
      if (pista) deseadas.set(clave, pista);
    });
    // quitar las que ya no van
    audios.forEach(function (a, clave) {
      if (deseadas.get(clave) !== a.pista) {
        try { a.pista.detach(a.el); } catch (e) { /* nada */ }
        a.el.remove();
        audios.delete(clave);
      }
    });
    // agregar las nuevas
    deseadas.forEach(function (pista, clave) {
      if (audios.has(clave)) return;
      const el = pista.attach();
      el.style.display = 'none';
      document.body.append(el);
      audios.set(clave, { pista: pista, el: el });
    });
  }

  function limpiarAudio() {
    audios.forEach(function (a) {
      try { a.pista.detach(a.el); } catch (e) { /* nada */ }
      a.el.remove();
    });
    audios.clear();
  }

  botonAudio.addEventListener('click', function () {
    if (room) room.startAudio().then(function () { botonAudio.classList.add('oculto'); });
  });

  /* ---------------- Conexión ---------------- */

  async function conectar() {
    clearTimeout(reintento);
    limpiarAudio();
    room = new LK.Room(S.opcionesSala({ dynacast: false }));
    const E = LK.RoomEvent;
    [E.ParticipantConnected, E.ParticipantDisconnected, E.TrackSubscribed, E.TrackUnsubscribed,
      E.TrackMuted, E.TrackUnmuted, E.TrackPublished, E.TrackUnpublished,
      E.ParticipantAttributesChanged, E.ParticipantNameChanged, E.ParticipantMetadataChanged,
      E.ActiveSpeakersChanged].forEach(function (ev) { room.on(ev, refrescar); });

    room.on(E.AudioPlaybackStatusChanged, function () {
      botonAudio.classList.toggle('oculto', room.canPlaybackAudio);
    });
    room.on(E.Reconnecting, function () { mostrarNota(''); });
    room.on(E.Disconnected, function (motivo) {
      limpiarAudio();
      if (motivo === LK.DisconnectReason.CLIENT_INITIATED) return;
      if (motivo === LK.DisconnectReason.DUPLICATE_IDENTITY) {
        mostrarNota('Este enlace de OBS se abrió en otro lugar. Usa una sola fuente de navegador con este enlace.');
        return;
      }
      // reintentar sin borrar lo que se ve en pantalla
      reintento = setTimeout(conectar, 5000);
    });

    try {
      await room.connect(S.CFG.livekitUrl, token, { autoSubscribe: true });
      mostrarNota('');
      botonAudio.classList.toggle('oculto', room.canPlaybackAudio);
      refrescar();
    } catch (err) {
      const msg = S.mensajeDeError(err);
      if (/pase/.test(msg)) {
        mostrarNota(msg + ' Genera un nuevo enlace para OBS en el panel del director.');
        return;
      }
      reintento = setTimeout(conectar, 5000);
    }
  }

  window.addEventListener('beforeunload', function () { if (room) room.disconnect(); });
  conectar();
})();
