/*
 * Sala Muchik - panel del director
 * Crea los enlaces, decide quién sale al aire y controla los gráficos.
 */
(function () {
  'use strict';
  const LK = window.LivekitClient;
  const S = window.Sala;
  const $ = function (id) { return document.getElementById(id); };

  const CLAVE_CRED = 'sala.cred';
  const CLAVE_EVENTO = 'sala.evento';
  const CLAVE_ESTADO = 'sala.estado';
  const CLAVE_RETORNO = 'sala.retorno';

  $('nombreApp').textContent = S.CFG.nombrePlataforma;
  $('credito').textContent = 'Desarrollado por ' + S.CFG.credito;
  document.title = 'Panel del director - ' + S.CFG.nombrePlataforma;
  [['icoLlave', 'llave'], ['icoSala', 'aire'], ['icoInvitados', 'enviar'], ['icoObs', 'obs'], ['icoAire', 'pantalla'],
    ['icoPersonas', 'personas'], ['icoRetorno', 'audifonos'], ['icoCintillo', 'cintillo'], ['icoMarca', 'estrella']]
    .forEach(function (par) { $(par[0]).outerHTML = S.icono(par[1]); });
  $('btnCopiarObs').innerHTML = S.icono('copiar');

  /* ------------------------------------------------------------ */
  /* Datos guardados                                               */
  /* ------------------------------------------------------------ */

  function salaPorDefecto() {
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    return 'evento-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }

  let cred = S.leerLocal(CLAVE_CRED, { apiKey: '', apiSecret: '' });
  let evento = Object.assign({ sala: salaPorDefecto(), invitados: [], obs: '' }, S.leerLocal(CLAVE_EVENTO, {}));
  let estado = S.normalizarEstado(S.leerLocal(CLAVE_ESTADO, null));
  let retorno = Object.assign({ escuchar: true }, S.leerLocal(CLAVE_RETORNO, {}));
  let room = null;

  function hayClaves() { return !!(cred.apiKey && cred.apiSecret); }
  function guardarEvento() { S.guardarLocal(CLAVE_EVENTO, evento); }

  /* ------------------------------------------------------------ */
  /* Vista previa                                                  */
  /* ------------------------------------------------------------ */

  const escenario = new S.Escenario($('previa'), { modo: 'vista' });
  S.escalarAlContenedor(escenario, $('previa'));

  /* ------------------------------------------------------------ */
  /* Publicar el estado a la sala                                  */
  /* ------------------------------------------------------------ */

  let enviando = Promise.resolve();
  function enviarEstado() {
    if (!room || room.state !== 'connected') return;
    const texto = JSON.stringify(estado);
    enviando = enviando.then(function () {
      return room.localParticipant.setAttributes({ estado: texto });
    }).catch(function (e) {
      console.warn('No se pudo enviar el estado', e);
      S.aviso('No se pudo actualizar el programa. Revisa la conexión.', 'error');
    });
  }
  const enviarEstadoLento = S.debounce(enviarEstado, 350);

  /** Llamar después de cualquier cambio de estado. lento=true para textos que se escriben. */
  function cambio(lento) {
    S.guardarLocal(CLAVE_ESTADO, estado);
    refrescar();
    if (lento) enviarEstadoLento(); else enviarEstado();
  }

  /* ------------------------------------------------------------ */
  /* Claves                                                        */
  /* ------------------------------------------------------------ */

  function pintarClaves() {
    $('inApiKey').value = cred.apiKey || '';
    $('inApiSecret').value = cred.apiSecret ? '••••••••••••••••' : '';
    $('inApiSecret').dataset.guardado = cred.apiSecret ? '1' : '';
    $('estadoClaves').textContent = hayClaves() ? 'Claves guardadas en este navegador.' : 'Aún no hay claves guardadas.';
    $('secClaves').open = !hayClaves();
  }

  $('inApiSecret').addEventListener('focus', function () {
    if (this.dataset.guardado) { this.value = ''; this.dataset.guardado = ''; }
  });

  $('btnGuardarClaves').addEventListener('click', function () {
    const k = $('inApiKey').value.trim();
    const sInput = $('inApiSecret');
    const s = sInput.dataset.guardado ? cred.apiSecret : sInput.value.trim();
    if (!k || !s) { S.aviso('Escribe la API Key y el API Secret', 'error'); return; }
    cred = { apiKey: k, apiSecret: s };
    S.guardarLocal(CLAVE_CRED, cred);
    pintarClaves();
    S.aviso('Claves guardadas', 'ok');
    if (!evento.obs) generarObs();
  });

  $('btnOlvidarClaves').addEventListener('click', function () {
    if (!confirm('¿Borrar las claves de este navegador?')) return;
    cred = { apiKey: '', apiSecret: '' };
    S.borrarLocal(CLAVE_CRED);
    pintarClaves();
  });

  /* ------------------------------------------------------------ */
  /* Sala del evento                                               */
  /* ------------------------------------------------------------ */

  function limpiarSala(texto) {
    return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }

  $('inSala').value = evento.sala;
  $('inSala').addEventListener('change', function () {
    const nueva = limpiarSala(this.value) || salaPorDefecto();
    if (nueva === evento.sala) { this.value = nueva; return; }
    if (evento.invitados.length && !confirm('Al cambiar la sala, los enlaces de invitados y de OBS anteriores dejarán de servir. ¿Continuar?')) {
      this.value = evento.sala; return;
    }
    evento.sala = nueva;
    evento.invitados = [];
    evento.obs = '';
    this.value = nueva;
    guardarEvento();
    pintarInvitados();
    if (room) { desconectar(); S.aviso('Cambiaste de sala. Vuelve a conectar el panel.', 'mensaje'); }
    generarObs();
  });

  if (location.protocol === 'file:' && !S.CFG.urlPublica) {
    $('avisoArchivo').classList.remove('oculto');
    $('avisoArchivo').textContent = 'Abriste el panel desde un archivo de tu PC. Para que los enlaces funcionen, ábrelo desde su dirección en internet (GitHub Pages) o escribe esa dirección en js/config.js (urlPublica).';
  }

  /* ------------------------------------------------------------ */
  /* Invitados                                                     */
  /* ------------------------------------------------------------ */

  function copiar(texto, mensaje) {
    function ok() { S.aviso(mensaje || 'Copiado', 'ok', 2500); }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(texto).then(ok, function () { copiarViejo(texto); ok(); });
    } else { copiarViejo(texto); ok(); }
  }
  function copiarViejo(texto) {
    const t = document.createElement('textarea');
    t.value = texto; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.append(t); t.select();
    try { document.execCommand('copy'); } catch (e) { /* nada */ }
    t.remove();
  }

  function textoInvitacion(inv) {
    const titulo = estado.titulo || evento.sala;
    return 'Hola ' + inv.nombre.split(' ')[0] + ', te invito a participar en "' + titulo + '".\n\n' +
      'Entra desde este enlace (celular o computadora, de preferencia con Google Chrome):\n' + inv.enlace + '\n\n' +
      'Te recomiendo usar audífonos y buscar un lugar con buena luz y silencio. ¡Gracias!';
  }

  function fechaCorta(ms) {
    const d = new Date(ms);
    return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) + ' ' +
      d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  }

  function pintarInvitados() {
    const caja = $('listaInvitados');
    caja.innerHTML = '';
    if (!evento.invitados.length) {
      caja.append(S.crearEl('p', 'ayuda', 'Todavía no creaste enlaces para esta sala.'));
      return;
    }
    evento.invitados.slice().reverse().forEach(function (inv) {
      const vencido = inv.vence < Date.now();
      const el = S.crearEl('div', 'invitado');
      const cab = S.crearEl('div', 'invitado-cab');
      cab.append(S.crearEl('span', 'invitado-nombre', inv.nombre),
        S.crearEl('span', 'invitado-vence', vencido ? 'Vencido' : 'Hasta ' + fechaCorta(inv.vence)));
      el.append(cab, S.crearEl('div', 'invitado-cargo', inv.cargo || '—'));
      const fila = S.crearEl('div', 'fila');
      const bCopiar = S.crearEl('button', 'btn chico'); bCopiar.type = 'button';
      bCopiar.innerHTML = S.icono('copiar') + 'Copiar';
      bCopiar.addEventListener('click', function () { copiar(inv.enlace, 'Enlace de ' + inv.nombre + ' copiado'); });
      const bWa = S.crearEl('button', 'btn chico'); bWa.type = 'button';
      bWa.innerHTML = S.icono('enviar') + 'WhatsApp';
      bWa.addEventListener('click', function () {
        window.open('https://wa.me/?text=' + encodeURIComponent(textoInvitacion(inv)), '_blank', 'noopener');
      });
      const bQuitar = S.crearEl('button', 'btn chico peligro'); bQuitar.type = 'button';
      bQuitar.title = 'Quitar de la lista';
      bQuitar.innerHTML = S.icono('quitar');
      bQuitar.addEventListener('click', function () {
        if (!confirm('¿Quitar a ' + inv.nombre + ' de la lista? (El enlace seguirá sirviendo hasta que venza; si ya está en la sala, usa "Sacar".)')) return;
        evento.invitados = evento.invitados.filter(function (x) { return x.id !== inv.id; });
        guardarEvento(); pintarInvitados();
      });
      fila.append(bCopiar, bWa, bQuitar);
      if (vencido) { bCopiar.disabled = true; bWa.disabled = true; }
      el.append(fila);
      caja.append(el);
    });
  }

  $('btnCrearInvitado').addEventListener('click', async function () {
    if (!hayClaves()) { $('secClaves').open = true; S.aviso('Primero guarda las claves del proyecto', 'error'); return; }
    const nombre = $('inInvNombre').value.trim();
    const cargo = $('inInvCargo').value.trim();
    if (!nombre) { S.aviso('Escribe el nombre del invitado', 'error'); $('inInvNombre').focus(); return; }
    const horas = Number($('selVigencia').value) || 168;
    const id = 'p-' + S.aleatorio(8);
    try {
      const t = await S.crearToken({
        apiKey: cred.apiKey, apiSecret: cred.apiSecret, sala: evento.sala,
        identidad: id, nombre: nombre, horas: horas,
        metadata: { rol: 'panelista', cargo: cargo, evento: estado.titulo || '' },
        permisos: { canPublish: true, canSubscribe: true, canPublishData: false, canUpdateOwnMetadata: true },
      });
      const inv = { id: id, nombre: nombre, cargo: cargo, enlace: S.urlBase() + '?t=' + t, vence: Date.now() + horas * 3600e3 };
      evento.invitados.push(inv);
      guardarEvento();
      pintarInvitados();
      $('inInvNombre').value = ''; $('inInvCargo').value = '';
      copiar(inv.enlace, 'Enlace de ' + nombre + ' creado y copiado');
    } catch (e) {
      S.aviso('No se pudo crear el enlace: ' + S.mensajeDeError(e), 'error');
    }
  });

  /* ------------------------------------------------------------ */
  /* Enlace para OBS                                               */
  /* ------------------------------------------------------------ */

  async function generarObs() {
    if (!hayClaves()) { $('inObs').value = ''; return; }
    try {
      const t = await S.crearToken({
        apiKey: cred.apiKey, apiSecret: cred.apiSecret, sala: evento.sala,
        identidad: S.ID_PROGRAMA, nombre: 'Programa OBS', horas: 24 * 30,
        metadata: { rol: 'programa' },
        permisos: { canPublish: false, canSubscribe: true, canPublishData: false, hidden: true },
      });
      evento.obs = S.urlBase() + 'programa.html?t=' + t;
      guardarEvento();
      $('inObs').value = evento.obs;
    } catch (e) { S.aviso('No se pudo crear el enlace de OBS: ' + S.mensajeDeError(e), 'error'); }
  }

  $('inObs').value = evento.obs || '';
  $('btnCopiarObs').addEventListener('click', function () {
    if (!evento.obs) { S.aviso('Primero guarda las claves del proyecto', 'error'); return; }
    copiar(evento.obs, 'Enlace de OBS copiado');
  });
  $('btnGenerarObs').addEventListener('click', function () {
    if (evento.obs && !confirm('El enlace anterior seguirá sirviendo hasta que venza, pero si lo pegas otra vez en OBS reemplaza al anterior. ¿Generar uno nuevo?')) return;
    generarObs().then(function () { if (evento.obs) copiar(evento.obs, 'Enlace de OBS nuevo copiado'); });
  });

  /* ------------------------------------------------------------ */
  /* Conexión del director                                         */
  /* ------------------------------------------------------------ */

  function pintarConexion(texto, clase) {
    const p = $('pillConexion');
    p.className = 'pill ' + (clase || '');
    p.textContent = texto;
    const conectado = !!room;
    $('btnConectar').textContent = conectado ? 'Desconectar' : 'Conectar al panel';
    $('btnConectar').classList.toggle('primario', !conectado);
  }

  $('btnConectar').addEventListener('click', function () {
    if (room) {
      if (confirm('¿Desconectar el panel? Lo que está al aire se mantiene en OBS.')) desconectar();
    } else conectar();
  });

  async function conectar() {
    if (!hayClaves()) { $('secClaves').open = true; S.aviso('Primero guarda las claves del proyecto', 'error'); return; }
    if (!S.CFG.livekitUrl) { S.aviso('Falta la dirección del proyecto en js/config.js', 'error'); return; }
    pintarConexion('Conectando…', 'alerta');
    $('btnConectar').disabled = true;
    let token;
    try {
      token = await S.crearToken({
        apiKey: cred.apiKey, apiSecret: cred.apiSecret, sala: evento.sala,
        identidad: S.ID_DIRECTOR, nombre: 'Producción', horas: 12,
        metadata: { rol: 'director' },
        permisos: { canPublish: true, canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: true, roomAdmin: true },
      });
    } catch (e) {
      $('btnConectar').disabled = false;
      pintarConexion('Desconectado');
      S.aviso(S.mensajeDeError(e), 'error');
      return;
    }

    room = new LK.Room(S.opcionesSala());
    escucharSala(room);
    try {
      await room.connect(S.CFG.livekitUrl, token);
    } catch (e) {
      room = null;
      $('btnConectar').disabled = false;
      pintarConexion('Desconectado');
      let msg = S.mensajeDeError(e);
      if (/pase/.test(msg)) msg = 'LiveKit rechazó las claves. Revisa que la API Key y el API Secret sean de este proyecto.';
      S.aviso(msg, 'error', 7000);
      return;
    }
    $('btnConectar').disabled = false;
    enviarEstado();
    pintarConexion('Conectado', 'ok');
    S.aviso('Panel conectado a la sala ' + evento.sala, 'ok');
    refrescar();
    pintarRetorno();
  }

  function desconectar() {
    if (!room) return;
    const r = room;
    room = null;
    r.disconnect();
    limpiarAudios();
    pintarConexion('Desconectado');
    refrescar();
    pintarRetorno();
  }

  function escucharSala(r) {
    const E = LK.RoomEvent;
    [E.ParticipantConnected, E.ParticipantDisconnected, E.TrackSubscribed, E.TrackUnsubscribed,
      E.TrackMuted, E.TrackUnmuted, E.TrackPublished, E.TrackUnpublished, E.ParticipantNameChanged,
      E.ParticipantMetadataChanged, E.ActiveSpeakersChanged, E.ConnectionQualityChanged,
      E.LocalTrackPublished, E.LocalTrackUnpublished].forEach(function (ev) { r.on(ev, refrescar); });

    r.on(E.ParticipantConnected, function (p) {
      if (S.esParticipanteDeEscena(p)) S.aviso((p.name || p.identity) + ' entró a la sala', 'ok', 3000);
    });
    r.on(E.ParticipantDisconnected, function (p) {
      if (S.esParticipanteDeEscena(p)) S.aviso((p.name || p.identity) + ' salió de la sala', 'mensaje', 3500);
    });
    r.on(E.TrackSubscribed, function (pista, pub) { if (pista.kind === 'audio') ponerAudio(pista, pub); });
    r.on(E.TrackUnsubscribed, function (pista, pub) { quitarAudio(pub.trackSid); });
    r.on(E.AudioPlaybackStatusChanged, function () {
      if (!r.canPlaybackAudio) {
        S.aviso('Haz clic en cualquier parte del panel para escuchar la sala', 'mensaje', 5000);
        document.addEventListener('click', function () { r.startAudio(); }, { once: true });
      }
    });
    r.on(E.Reconnecting, function () { pintarConexion('Reconectando…', 'alerta'); });
    r.on(E.Reconnected, function () { pintarConexion('Conectado', 'ok'); enviarEstado(); });
    r.on(E.Disconnected, function (motivo) {
      if (room !== r) return; // desconexión pedida por nosotros
      room = null;
      limpiarAudios();
      pintarConexion('Desconectado');
      refrescar();
      pintarRetorno();
      if (motivo === LK.DisconnectReason.DUPLICATE_IDENTITY) S.aviso('El panel se abrió en otra pestaña o computadora. Esta quedó desconectada.', 'error', 8000);
      else if (motivo !== LK.DisconnectReason.CLIENT_INITIATED) S.aviso('Se perdió la conexión del panel. Vuelve a conectar.', 'error', 8000);
    });
  }

  /* ------------------------------------------------------------ */
  /* Audio de la sala en el panel (retorno)                        */
  /* ------------------------------------------------------------ */

  const audios = new Map();
  function ponerAudio(pista, pub) {
    if (!retorno.escuchar || audios.has(pub.trackSid)) return;
    const el = pista.attach();
    el.style.display = 'none';
    document.body.append(el);
    audios.set(pub.trackSid, { pista: pista, el: el });
  }
  function quitarAudio(sid) {
    const a = audios.get(sid);
    if (!a) return;
    try { a.pista.detach(a.el); } catch (e) { /* nada */ }
    a.el.remove();
    audios.delete(sid);
  }
  function limpiarAudios() { Array.from(audios.keys()).forEach(quitarAudio); }
  function aplicarEscucha() {
    limpiarAudios();
    if (!room || !retorno.escuchar) return;
    room.remoteParticipants.forEach(function (p) {
      p.audioTrackPublications.forEach(function (pub) { if (pub.track) ponerAudio(pub.track, pub); });
    });
  }

  function pintarRetorno() {
    const lp = room ? room.localParticipant : null;
    const mic = !!(lp && lp.isMicrophoneEnabled), cam = !!(lp && lp.isCameraEnabled);
    $('btnHablar').innerHTML = S.icono(mic ? 'mic' : 'micOff') + (mic ? 'Hablando a panelistas' : 'Hablar a panelistas');
    $('btnHablar').classList.toggle('activo', mic);
    $('btnMiCam').innerHTML = S.icono(cam ? 'cam' : 'camOff') + (cam ? 'Mi cámara visible' : 'Mostrar mi cámara');
    $('btnMiCam').classList.toggle('activo', cam);
    $('btnEscuchar').innerHTML = S.icono(retorno.escuchar ? 'altavoz' : 'micOff') + (retorno.escuchar ? 'Escuchando la sala' : 'Sala en silencio');
    $('btnEscuchar').classList.toggle('encendido', retorno.escuchar);
    $('btnHablar').disabled = !room; $('btnMiCam').disabled = !room;
  }

  $('btnHablar').addEventListener('click', async function () {
    if (!room) return;
    try { await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled); }
    catch (e) { S.aviso(S.mensajeDeError(e), 'error'); }
    pintarRetorno();
  });
  $('btnMiCam').addEventListener('click', async function () {
    if (!room) return;
    try { await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled); }
    catch (e) { S.aviso(S.mensajeDeError(e), 'error'); }
    pintarRetorno();
  });
  $('btnEscuchar').addEventListener('click', function () {
    retorno.escuchar = !retorno.escuchar;
    S.guardarLocal(CLAVE_RETORNO, retorno);
    aplicarEscucha();
    pintarRetorno();
  });

  /* ------------------------------------------------------------ */
  /* Acciones sobre participantes                                  */
  /* ------------------------------------------------------------ */

  async function apiSala(metodo, cuerpo) {
    const t = await S.crearToken({
      apiKey: cred.apiKey, apiSecret: cred.apiSecret, sala: evento.sala,
      identidad: 'director-api', horas: 0.1, permisos: { roomAdmin: true },
    });
    const base = S.CFG.livekitUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/$/, '');
    const r = await fetch(base + '/twirp/livekit.RoomService/' + metodo, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  function enviarOrden(identidad, orden) {
    if (!room) return Promise.resolve();
    const datos = new TextEncoder().encode(JSON.stringify(orden));
    return room.localParticipant.publishData(datos, { reliable: true, destinationIdentities: [identidad], topic: 'sala' });
  }

  function alternarAire(clave) {
    const i = estado.enVivo.indexOf(clave);
    if (i >= 0) {
      estado.enVivo.splice(i, 1);
      if (estado.destacado === clave) estado.destacado = null;
    } else {
      estado.enVivo.push(clave);
    }
    cambio();
  }

  function destacar(clave) {
    if (estado.enVivo.indexOf(clave) < 0) estado.enVivo.push(clave);
    estado.destacado = clave;
    if (estado.diseno === 'auto' || estado.diseno === 'cuadricula') estado.diseno = 'destacado';
    cambio();
  }

  function cintilloDe(p) {
    const n = S.nombreDe(p, estado);
    const mismo = estado.cintillo.visible && estado.cintillo.titulo === n.nombre;
    estado.cintillo = { visible: !mismo, titulo: n.nombre, subtitulo: n.cargo };
    pintarTextos();
    cambio();
  }

  async function silenciar(p) {
    const pub = p.getTrackPublication(LK.Track.Source.Microphone);
    if (!pub) return;
    try {
      await apiSala('MutePublishedTrack', { room: evento.sala, identity: p.identity, track_sid: pub.trackSid, muted: true });
    } catch (e) {
      await enviarOrden(p.identity, { accion: 'silenciar' });
    }
    S.aviso('Micrófono de ' + (p.name || p.identity) + ' silenciado', 'ok', 2500);
  }

  async function mensaje(p) {
    const texto = prompt('Mensaje para ' + (p.name || p.identity) + ' (le aparece en su pantalla):', 'Entras al aire en 1 minuto');
    if (!texto) return;
    await enviarOrden(p.identity, { accion: 'mensaje', texto: texto.slice(0, 200) });
    S.aviso('Mensaje enviado', 'ok', 2000);
  }

  function editar(p) {
    const n = S.nombreDe(p, estado);
    const nombre = prompt('Nombre que aparece en pantalla:', n.nombre);
    if (nombre === null) return;
    const cargo = prompt('Cargo o institución:', n.cargo);
    if (cargo === null) return;
    estado.etiquetas[p.identity] = { nombre: nombre.trim() || n.nombre, cargo: cargo.trim() };
    cambio();
  }

  async function sacar(p) {
    if (!confirm('¿Sacar a ' + (p.name || p.identity) + ' de la sala?')) return;
    estado.enVivo = estado.enVivo.filter(function (c) { return c.split(':')[0] !== p.identity; });
    if (estado.destacado && estado.destacado.split(':')[0] === p.identity) estado.destacado = null;
    cambio();
    try {
      await apiSala('RemoveParticipant', { room: evento.sala, identity: p.identity });
    } catch (e) {
      await enviarOrden(p.identity, { accion: 'salir' });
    }
  }

  /* ------------------------------------------------------------ */
  /* Cartas de participantes                                       */
  /* ------------------------------------------------------------ */

  const cartas = new Map(); // clave -> { el, video, pista, ... }

  /** Coloca el elemento en la posición indicada sin moverlo si ya está ahí (evita cortes de video). */
  function ponerEnOrden(caja, el, i) {
    const actual = caja.children[i];
    if (actual !== el) caja.insertBefore(el, actual || null);
  }

  function boton(icono, texto, clase, accion, titulo) {
    const b = S.crearEl('button', 'btn chico ' + (clase || ''));
    b.type = 'button';
    b.innerHTML = S.icono(icono) + (texto ? '<span>' + texto + '</span>' : '');
    if (titulo) b.title = titulo;
    b.addEventListener('click', accion);
    return b;
  }

  function crearCarta(clave) {
    const el = S.crearEl('div', 'carta');
    const zona = S.crearEl('div', 'carta-video');
    const ini = S.crearEl('div', 'iniciales');
    const video = document.createElement('video');
    video.autoplay = true; video.muted = true; video.playsInline = true;
    const ins = S.crearEl('div', 'carta-insignias');
    zona.append(ini, video, ins);
    const info = S.crearEl('div', 'carta-info');
    const nombre = S.crearEl('div', 'carta-nombre');
    const cargo = S.crearEl('div', 'carta-cargo');
    info.append(nombre, cargo);
    const acciones = S.crearEl('div', 'carta-acciones');
    el.append(zona, info, acciones);
    return { el: el, zona: zona, video: video, ini: ini, ins: ins, nombre: nombre, cargo: cargo, acciones: acciones, pista: null, clave: clave, tipo: null };
  }

  function participante(identidad) { return room ? room.remoteParticipants.get(identidad) : null; }

  function armarAcciones(c, identidad, esPantalla) {
    c.acciones.innerHTML = '';
    const clave = c.clave;
    function con(fn) { return function () { const p = participante(identidad); if (p) fn(p); }; }
    c.bAire = boton('aire', 'Al aire', 'aire', function () { alternarAire(clave); });
    c.acciones.append(c.bAire);
    c.bDest = boton('estrella', '', '', function () { destacar(clave); }, 'Destacar (recuadro grande)');
    c.acciones.append(c.bDest);
    if (esPantalla) return;
    c.acciones.append(
      boton('cintillo', '', '', con(cintilloDe), 'Mostrar/ocultar su cintillo grande'),
      boton('micOff', '', '', con(silenciar), 'Silenciar su micrófono'),
      boton('mensaje', '', '', con(mensaje), 'Enviarle un mensaje'),
      boton('editar', '', '', con(editar), 'Corregir nombre o cargo'),
      boton('salir', '', 'peligro', con(sacar), 'Sacar de la sala'));
  }

  function dibujarCartas() {
    const caja = $('participantes');
    const vigentes = new Set();
    let personas = 0;
    let orden = 0;
    if (room) {
      room.remoteParticipants.forEach(function (p) {
        if (!S.esParticipanteDeEscena(p)) return;
        personas++;
        const n = S.nombreDe(p, estado);
        const cam = p.getTrackPublication(LK.Track.Source.Camera);
        const pan = p.getTrackPublication(LK.Track.Source.ScreenShare);
        const items = [{ clave: p.identity + ':cam', pantalla: false, pista: cam && cam.track && !cam.isMuted ? cam.track : null, nombre: n.nombre, cargo: n.cargo }];
        if (pan) items.push({ clave: p.identity + ':pantalla', pantalla: true, pista: pan.track || null, nombre: 'Pantalla de ' + n.nombre, cargo: 'Pantalla compartida' });

        items.forEach(function (it) {
          vigentes.add(it.clave);
          let c = cartas.get(it.clave);
          if (!c) {
            c = crearCarta(it.clave);
            cartas.set(it.clave, c);
            armarAcciones(c, p.identity, it.pantalla);
          }
          ponerEnOrden(caja, c.el, orden++);
          const alAire = estado.enVivo.indexOf(it.clave) >= 0;
          c.el.classList.toggle('al-aire', alAire);
          c.el.classList.toggle('pantalla', it.pantalla);
          c.el.classList.toggle('hablando', !it.pantalla && p.isSpeaking);
          c.zona.classList.toggle('con-video', !!it.pista);
          c.nombre.textContent = it.nombre;
          c.cargo.textContent = it.cargo || '';
          c.ini.textContent = S.iniciales(n.nombre);
          c.bAire.innerHTML = S.icono('aire') + '<span>' + (alAire ? 'Quitar del aire' : 'Poner al aire') + '</span>';
          c.bAire.classList.toggle('activo', alAire);
          c.bDest.classList.toggle('encendido', estado.destacado === it.clave);
          // insignias
          c.ins.innerHTML = '';
          const izq = S.crearEl('div', 'fila'); izq.style.gap = '5px';
          if (alAire) izq.append(S.crearEl('span', 'insignia aire', 'AL AIRE'));
          if (!it.pantalla && !p.isMicrophoneEnabled) izq.append(S.crearEl('span', 'insignia mic-off', 'SIN MIC'));
          const der = S.crearEl('div');
          const q = p.connectionQuality;
          if (!it.pantalla && (q === LK.ConnectionQuality.Poor || q === LK.ConnectionQuality.Lost)) {
            der.append(S.crearEl('span', 'insignia calidad-' + q, q === LK.ConnectionQuality.Lost ? 'SIN SEÑAL' : 'SEÑAL DÉBIL'));
          }
          c.ins.append(izq, der);
          if (it.pista !== c.pista) {
            if (c.pista) { try { c.pista.detach(c.video); } catch (e) { /* nada */ } }
            c.pista = it.pista;
            if (it.pista) it.pista.attach(c.video);
          }
        });
      });
    }
    cartas.forEach(function (c, clave) {
      if (vigentes.has(clave)) return;
      if (c.pista) { try { c.pista.detach(c.video); } catch (e) { /* nada */ } }
      c.el.remove();
      cartas.delete(clave);
    });
    $('sinParticipantes').classList.toggle('oculto', vigentes.size > 0);
    $('sinParticipantes').textContent = room
      ? 'Todavía no entra nadie. Envía los enlaces a tus invitados.'
      : 'Conéctate al panel y envía los enlaces a tus invitados. Aquí aparecerán cuando entren.';
    $('contador').textContent = room ? '(' + personas + ')' : '';
    if (room && room.state === 'connected') pintarConexion('Conectado · ' + personas + (personas === 1 ? ' invitado' : ' invitados'), 'ok');
  }

  /* ------------------------------------------------------------ */
  /* Diseños y textos                                              */
  /* ------------------------------------------------------------ */

  Array.prototype.forEach.call($('disenos').querySelectorAll('button'), function (b) {
    b.addEventListener('click', function () { estado.diseno = b.dataset.diseno; cambio(); });
  });

  $('btnTodosFuera').addEventListener('click', function () {
    estado.enVivo = []; estado.destacado = null; cambio();
  });
  $('btnLimpiarGraficos').addEventListener('click', function () {
    estado.cintillo.visible = false; estado.mostrarBanner = false;
    pintarTextos(); cambio();
  });

  function pintarTextos() {
    $('inTitulo').value = estado.titulo;
    $('chkTitulo').checked = estado.mostrarTitulo;
    $('inCtTitulo').value = estado.cintillo.titulo;
    $('inCtSub').value = estado.cintillo.subtitulo;
    $('btnCintillo').innerHTML = S.icono('cintillo') + (estado.cintillo.visible ? 'Ocultar cintillo' : 'Mostrar cintillo');
    $('btnCintillo').classList.toggle('activo', estado.cintillo.visible);
    $('inBanner').value = estado.banner;
    $('chkBanner').checked = estado.mostrarBanner;
    $('chkDesplazar').checked = estado.desplazar;
    $('chkNombres').checked = estado.nombres;
    $('chkResaltar').checked = estado.resaltar;
    $('inLogo').value = estado.logo;
    $('colMarca').value = estado.colorMarca || S.CFG.colorMarca;
    $('colFondo').value = estado.colorFondo || S.CFG.colorFondo;
    $('inFondoImg').value = estado.fondoImagen;
    $('chkTransparente').checked = estado.fondoTransparente;
  }

  function enlazarTexto(id, aplicar) {
    $(id).addEventListener('input', function () { aplicar(this.value); cambio(true); });
  }
  function enlazarCheck(id, aplicar) {
    $(id).addEventListener('change', function () { aplicar(this.checked); cambio(); });
  }

  enlazarTexto('inTitulo', function (v) { estado.titulo = v; });
  enlazarCheck('chkTitulo', function (v) { estado.mostrarTitulo = v; });
  enlazarTexto('inCtTitulo', function (v) { estado.cintillo.titulo = v; });
  enlazarTexto('inCtSub', function (v) { estado.cintillo.subtitulo = v; });
  enlazarTexto('inBanner', function (v) { estado.banner = v; });
  enlazarCheck('chkBanner', function (v) { estado.mostrarBanner = v; });
  enlazarCheck('chkDesplazar', function (v) { estado.desplazar = v; });
  enlazarCheck('chkNombres', function (v) { estado.nombres = v; });
  enlazarCheck('chkResaltar', function (v) { estado.resaltar = v; });
  enlazarTexto('inLogo', function (v) { estado.logo = v.trim(); });
  enlazarTexto('colMarca', function (v) { estado.colorMarca = v; });
  enlazarTexto('colFondo', function (v) { estado.colorFondo = v; });
  enlazarTexto('inFondoImg', function (v) { estado.fondoImagen = v.trim(); });
  enlazarCheck('chkTransparente', function (v) { estado.fondoTransparente = v; });

  $('btnCintillo').addEventListener('click', function () {
    if (!estado.cintillo.visible && !estado.cintillo.titulo && !estado.cintillo.subtitulo) {
      S.aviso('Escribe el texto del cintillo', 'error'); $('inCtTitulo').focus(); return;
    }
    estado.cintillo.visible = !estado.cintillo.visible;
    pintarTextos(); cambio();
  });

  /* ------------------------------------------------------------ */
  /* Refresco general                                              */
  /* ------------------------------------------------------------ */

  let pendiente = false;
  function refrescar() {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(function () {
      pendiente = false;
      const fuentes = S.fuentesDeSala(room, estado);
      escenario.actualizar(estado, fuentes);
      $('previa').classList.toggle('al-aire', S.calcularDiseno(estado, fuentes).length > 0);
      Array.prototype.forEach.call($('disenos').querySelectorAll('button'), function (b) {
        b.classList.toggle('activo', b.dataset.diseno === estado.diseno);
      });
      dibujarCartas();
      if (estado.cintillo) $('btnCintillo').classList.toggle('activo', !!estado.cintillo.visible);
    });
  }

  window.addEventListener('beforeunload', function (e) {
    if (room) { room.disconnect(); }
  });

  /* ------------------------------------------------------------ */
  /* Inicio                                                        */
  /* ------------------------------------------------------------ */
  pintarClaves();
  pintarInvitados();
  pintarTextos();
  pintarRetorno();
  pintarConexion('Desconectado');
  refrescar();
  if (hayClaves() && !evento.obs) generarObs();
})();
