/*
 * Sala Muchik - página de programa (fuente de navegador en OBS)
 * Entra a la sala como espectador invisible y dibuja lo que manda el director.
 * Para no gastar la cuota gratis: solo se queda conectada si la producción abrió
 * la sala, y se desconecta sola si se queda sin nadie o si se termina el evento.
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
  let intentos = 0;
  let salidaPropia = false;   // nos desconectamos nosotros (sala cerrada o vacía)
  let terminado = false;      // la producción terminó el evento
  let vigilancia = null;
  const audios = new Map();   // clave -> { pista, el }

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
    audios.forEach(function (a, clave) {
      if (deseadas.get(clave) !== a.pista) {
        try { a.pista.detach(a.el); } catch (e) { /* nada */ }
        a.el.remove();
        audios.delete(clave);
      }
    });
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

  function programarReintento(ms) {
    clearTimeout(reintento);
    if (terminado) return;
    intentos++;
    // cada 30 s los primeros 10 minutos, luego cada minuto
    reintento = setTimeout(conectar, ms || (intentos <= 20 ? 30000 : 60000));
  }

  function salirNosotros() {
    salidaPropia = true;
    clearInterval(vigilancia);
    if (room) room.disconnect();
  }

  function suscribirTodo() {
    room.remoteParticipants.forEach(function (p) {
      p.trackPublications.forEach(function (pub) { try { pub.setSubscribed(true); } catch (e) { /* nada */ } });
    });
  }

  function vigilarSoledad() {
    // Si nos quedamos solos (nadie más en la sala) por 2 minutos, salimos para no gastar
    let solo = 0;
    clearInterval(vigilancia);
    vigilancia = setInterval(function () {
      if (!room || room.state !== 'connected') return;
      solo = room.remoteParticipants.size === 0 ? solo + 1 : 0;
      if (solo >= 4) { salirNosotros(); programarReintento(); }
    }, 30000);
  }

  async function conectar() {
    clearTimeout(reintento);
    limpiarAudio();
    salidaPropia = false;
    const r = new LK.Room(S.opcionesSala({ dynacast: false }));
    room = r;
    const E = LK.RoomEvent;
    [E.ParticipantConnected, E.ParticipantDisconnected, E.TrackSubscribed, E.TrackUnsubscribed,
      E.TrackMuted, E.TrackUnmuted, E.TrackPublished, E.TrackUnpublished,
      E.ParticipantAttributesChanged, E.ParticipantNameChanged, E.ParticipantMetadataChanged,
      E.ActiveSpeakersChanged].forEach(function (ev) { r.on(ev, refrescar); });

    r.on(E.TrackPublished, function (pub) { try { pub.setSubscribed(true); } catch (e) { /* nada */ } });
    r.on(E.AudioPlaybackStatusChanged, function () {
      botonAudio.classList.toggle('oculto', r.canPlaybackAudio);
    });
    r.on(E.DataReceived, function (carga, participante, tipo, tema) {
      if (!participante || participante.identity !== S.ID_DIRECTOR || tema !== 'sala') return;
      let m = null;
      try { m = JSON.parse(new TextDecoder().decode(carga)); } catch (e) { return; }
      if (m.accion === 'terminar') { terminado = true; salirNosotros(); }
    });
    r.on(E.Disconnected, function (motivo) {
      if (room !== r) return;
      clearInterval(vigilancia);
      limpiarAudio();
      escenario.actualizar(estado, new Map());
      if (salidaPropia || terminado) return;
      const DR = LK.DisconnectReason;
      if (motivo === DR.ROOM_DELETED || motivo === DR.ROOM_CLOSED || motivo === DR.PARTICIPANT_REMOVED) {
        terminado = true; // la producción terminó el evento
        return;
      }
      if (motivo === DR.DUPLICATE_IDENTITY) {
        mostrarNota('Este enlace de OBS se abrió en otro lugar. Usa una sola fuente de navegador con este enlace.');
        return;
      }
      if (motivo === DR.CLIENT_INITIATED) return;
      programarReintento(5000); // se cortó: volver a intentar pronto
    });

    try {
      await r.connect(S.CFG.livekitUrl, token, { autoSubscribe: false });
    } catch (err) {
      const msg = S.mensajeDeError(err);
      if (/pase/.test(msg)) {
        mostrarNota(msg + ' Genera un nuevo enlace para OBS en el panel del director.');
        return;
      }
      programarReintento();
      return;
    }

    // ¿La producción ya abrió la sala? Si no, salimos y probamos más tarde.
    if (!r.remoteParticipants.has(S.ID_DIRECTOR)) {
      salirNosotros();
      programarReintento();
      return;
    }

    intentos = 0;
    mostrarNota('');
    suscribirTodo();
    vigilarSoledad();
    botonAudio.classList.toggle('oculto', r.canPlaybackAudio);
    refrescar();
  }

  window.addEventListener('beforeunload', function () { salirNosotros(); });
  conectar();
})();
