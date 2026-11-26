/*
 * Sala Muchik - panel del director
 * Abre la sala, crea los enlaces, decide quién sale al aire, controla los
 * gráficos y termina el evento.
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
  const YO = S.ID_DIRECTOR + ':cam';

  const PLANTILLA = '{nombre}, te recordamos que {cuando} estás invitado al «{evento}». ' +
    'Ingresa 5 minutos antes en el siguiente enlace:\n{enlace}\n\n' +
    'Usa audífonos y busca un lugar con buena luz. ¡Gracias!';

  $('nombreApp').textContent = S.CFG.nombrePlataforma;
  $('credito').textContent = S.textoCredito();
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
  let evento = Object.assign({ sala: salaPorDefecto(), fecha: 0, antes: 30, plantilla: PLANTILLA, acortar: true, invitados: [], obs: '' },
    S.leerLocal(CLAVE_EVENTO, {}));
  let estado = S.normalizarEstado(S.leerLocal(CLAVE_ESTADO, null));
  let retorno = Object.assign({ escuchar: true }, S.leerLocal(CLAVE_RETORNO, {}));
  let room = null;

  function hayClaves() { return !!(cred.apiKey && cred.apiSecret); }
  function guardarEvento() { S.guardarLocal(CLAVE_EVENTO, evento); }
  function conectado() { return !!(room && room.state === 'connected'); }

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
    if (!conectado()) return;
    const texto = JSON.stringify(estado);
    const r = room;
    enviando = enviando.then(function () {
      return r.localParticipant.setAttributes({ estado: texto });
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

  function quitarDelAire(identidad) {
    const antes = estado.enVivo.length;
    estado.enVivo = estado.enVivo.filter(function (c) { return c.split(':')[0] !== identidad; });
    if (estado.destacado && estado.destacado.split(':')[0] === identidad) estado.destacado = null;
    return antes !== estado.enVivo.length;
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
  /* Evento: título, fecha y sala                                  */
  /* ------------------------------------------------------------ */

  function limpiarSala(texto) {
    return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }

  function aFechaLocal(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function horaTexto(ms) {
    return new Date(ms).toLocaleTimeString('es-PE', { hour: 'numeric', minute: '2-digit' });
  }

  function cuandoTexto(ms) {
    if (!ms) return '';
    const d = new Date(ms), hoy = new Date();
    const manana = new Date(); manana.setDate(hoy.getDate() + 1);
    const mismoDia = function (a, b) { return a.toDateString() === b.toDateString(); };
    let dia;
    if (mismoDia(d, hoy)) dia = 'hoy';
    else if (mismoDia(d, manana)) dia = 'mañana';
    else dia = 'el ' + d.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });
    return dia + ' a las ' + horaTexto(ms);
  }

  /** Ventana en la que sirven los enlaces: { nbf, exp } en segundos, o null si no hay fecha. */
  function ventanaDelEvento() {
    if (!evento.fecha) return null;
    const antes = Number(evento.antes);
    return {
      nbf: antes >= 0 ? (evento.fecha - antes * 60000) / 1000 - 120 : null,
      exp: (evento.fecha + 8 * 3600e3) / 1000,
    };
  }

  function pintarEvento() {
    $('inTitulo').value = estado.titulo || '';
    $('inSala').value = evento.sala;
    $('inFecha').value = aFechaLocal(evento.fecha);
    $('selAntes').value = String(evento.antes);
    $('filaVigencia').classList.toggle('oculto', !!evento.fecha);
    const ayuda = $('ayudaHorario');
    if (evento.fecha) {
      const antes = Number(evento.antes);
      const cuando = cuandoTexto(evento.fecha);
      ayuda.textContent = 'Evento ' + cuando + (/\.$/.test(cuando) ? ' ' : '. ') +
        (antes >= 0 ? 'Los enlaces funcionan desde las ' + horaTexto(evento.fecha - antes * 60000) + ' hasta 8 horas después. ' : 'Los enlaces funcionan hasta 8 horas después. ') +
        'Aun así, solo entran cuando tú abres la sala.';
    } else {
      ayuda.textContent = 'Sin fecha, los enlaces sirven el tiempo que elijas abajo. Los invitados solo entran cuando tú abres la sala.';
    }
    $('chkAcortar').checked = !!evento.acortar;
    $('inPlantilla').value = evento.plantilla || PLANTILLA;
  }

  $('inTitulo').addEventListener('input', function () { estado.titulo = this.value; cambio(true); });

  $('inFecha').addEventListener('change', function () {
    const nueva = this.value ? new Date(this.value).getTime() : 0;
    if (evento.invitados.length && nueva !== evento.fecha) {
      S.aviso('Cambiaste la fecha: los enlaces ya creados mantienen su horario anterior. Créalos de nuevo si hace falta.', 'mensaje', 7000);
    }
    evento.fecha = nueva || 0;
    guardarEvento(); pintarEvento();
  });

  $('selAntes').addEventListener('change', function () {
    evento.antes = Number(this.value);
    guardarEvento(); pintarEvento();
  });

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
    if (room) { desconectar(); S.aviso('Cambiaste de sala. Vuelve a abrirla.', 'mensaje'); }
    generarObs();
  });

  $('chkAcortar').addEventListener('change', function () { evento.acortar = this.checked; guardarEvento(); });
  $('inPlantilla').addEventListener('input', function () { evento.plantilla = this.value; guardarEvento(); });
  $('btnPlantillaOriginal').addEventListener('click', function () {
    evento.plantilla = PLANTILLA; guardarEvento(); $('inPlantilla').value = PLANTILLA;
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

  function enlaceDe(inv) { return inv.corto || inv.enlace; }

  function textoInvitacion(inv) {
    const plantilla = evento.plantilla || PLANTILLA;
    return plantilla
      .replace(/\{nombre\}/g, inv.nombre)
      .replace(/\{evento\}/g, estado.titulo || evento.sala)
      .replace(/\{cuando\}/g, cuandoTexto(inv.hora || evento.fecha))
      .replace(/\{enlace\}/g, enlaceDe(inv))
      .replace(/[ \t]{2,}/g, ' ');
  }

  /** Acorta con is.gd (JSONP). Intenta un enlace con el nombre del invitado, ej.: is.gd/AlbertoQuispe_k3x */
  function acortar(url, nombre) {
    function pedir(codigo) {
      return new Promise(function (resolver, rechazar) {
        const cb = 'isgd_' + S.aleatorio(8);
        const s = document.createElement('script');
        const tiempo = setTimeout(function () { limpiar(); rechazar(new Error('sin respuesta')); }, 9000);
        function limpiar() { clearTimeout(tiempo); delete window[cb]; s.remove(); }
        window[cb] = function (r) {
          limpiar();
          if (r && r.shorturl) resolver(r.shorturl);
          else rechazar(Object.assign(new Error((r && r.errormessage) || 'error'), { codigo: r && r.errorcode }));
        };
        s.onerror = function () { limpiar(); rechazar(new Error('no disponible')); };
        s.src = 'https://is.gd/create.php?format=json&callback=' + cb + '&url=' + encodeURIComponent(url) +
          (codigo ? '&shorturl=' + encodeURIComponent(codigo) : '');
        document.head.append(s);
      });
    }
    const base = String(nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .split(/[^A-Za-z0-9]+/).filter(Boolean).slice(0, 2)
      .map(function (p) { return p[0].toUpperCase() + p.slice(1).toLowerCase(); }).join('').slice(0, 22);
    const codigo = base.length >= 2 ? base + '_' + S.aleatorio(3) : '';
    return pedir(codigo).catch(function (e) {
      if (codigo && e.codigo === 2) return pedir('');
      throw e;
    });
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
      if (inv.corto) el.append(S.crearEl('div', 'invitado-enlace', inv.corto));
      const fila = S.crearEl('div', 'fila');
      const bCopiar = S.crearEl('button', 'btn chico'); bCopiar.type = 'button';
      bCopiar.innerHTML = S.icono('copiar') + 'Copiar';
      bCopiar.addEventListener('click', function () { copiar(enlaceDe(inv), 'Enlace de ' + inv.nombre + ' copiado'); });
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
    const boton = this;
    boton.disabled = true;
    boton.textContent = 'Creando enlace…';
    const id = 'p-' + S.aleatorio(6);
    const v = ventanaDelEvento();
    const horas = Number($('selVigencia').value) || 168;
    const meta = { cargo: cargo, evento: estado.titulo || '' };
    if (evento.fecha) meta.hora = evento.fecha;
    try {
      const t = await S.crearToken({
        apiKey: cred.apiKey, apiSecret: cred.apiSecret, sala: evento.sala,
        identidad: id, nombre: nombre, metadata: meta,
        horas: horas, nbf: v && v.nbf, exp: v && v.exp,
        permisos: { canPublishData: false, canUpdateOwnMetadata: true },
      });
      const inv = {
        id: id, nombre: nombre, cargo: cargo, hora: evento.fecha || 0,
        enlace: S.urlBase() + '?t=' + t,
        vence: v ? v.exp * 1000 : Date.now() + horas * 3600e3,
      };
      if (evento.acortar) {
        try { inv.corto = await acortar(inv.enlace, nombre); }
        catch (e) { S.aviso('No se pudo acortar (' + e.message + '). Se usará el enlace largo.', 'mensaje', 5000); }
      }
      evento.invitados.push(inv);
      guardarEvento();
      pintarInvitados();
      $('inInvNombre').value = ''; $('inInvCargo').value = '';
      copiar(enlaceDe(inv), 'Enlace de ' + nombre + ' creado y copiado');
    } catch (e) {
      S.aviso('No se pudo crear el enlace: ' + S.mensajeDeError(e), 'error');
    }
    boton.disabled = false;
    boton.textContent = 'Crear enlace de invitado';
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
        permisos: { canPublish: false, canPublishData: false, hidden: true },
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
  /* Abrir sala, cerrar panel y terminar evento                    */
  /* ------------------------------------------------------------ */

  function pintarConexion(texto, clase) {
    const p = $('pillConexion');
    p.className = 'pill ' + (clase || '');
    p.textContent = texto;
    const hay = !!room;
    $('btnConectar').textContent = hay ? 'Cerrar panel' : 'Abrir sala';
    $('btnConectar').classList.toggle('primario', !hay);
    $('btnTerminar').classList.toggle('oculto', !hay);
  }

  $('btnConectar').addEventListener('click', function () {
    if (room) {
      if (confirm('¿Cerrar el panel? Los invitados que están en la sala se quedan conectados (para sacar a todos usa "Terminar evento").')) desconectar();
    } else conectar();
  });

  async function conectar() {
    if (!hayClaves()) { $('secClaves').open = true; S.aviso('Primero guarda las claves del proyecto', 'error'); return; }
    if (!S.CFG.livekitUrl) { S.aviso('Falta la dirección del proyecto en js/config.js', 'error'); return; }
    pintarConexion('Abriendo…', 'alerta');
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
      pintarConexion('Sala cerrada');
      S.aviso(S.mensajeDeError(e), 'error');
      return;
    }

    const r = new LK.Room(S.opcionesSala());
    room = r;
    escucharSala(r);
    try {
      await r.connect(S.CFG.livekitUrl, token);
    } catch (e) {
      room = null;
      $('btnConectar').disabled = false;
      pintarConexion('Sala cerrada');
      let msg = S.mensajeDeError(e);
      if (/pase/.test(msg)) msg = 'LiveKit rechazó las claves. Revisa que la API Key y el API Secret sean de este proyecto.';
      S.aviso(msg, 'error', 7000);
      return;
    }
    $('btnConectar').disabled = false;
    // Todos empiezan en espera: se limpia lo que haya quedado al aire de antes
    const presentes = new Set(Array.from(r.remoteParticipants.keys()));
    estado.enVivo = estado.enVivo.filter(function (c) { return presentes.has(c.split(':')[0]); });
    if (estado.destacado && estado.enVivo.indexOf(estado.destacado) < 0) estado.destacado = null;
    S.guardarLocal(CLAVE_ESTADO, estado);
    enviarEstado();
    pintarConexion('Sala abierta', 'ok');
    S.aviso('Sala ' + evento.sala + ' abierta. Los invitados ya pueden entrar.', 'ok');
    refrescar();
    pintarRetorno();
  }

  function desconectar() {
    if (!room) return;
    const r = room;
    room = null;
    r.disconnect();
    limpiarAudios();
    pintarConexion('Sala cerrada');
    refrescar();
    pintarRetorno();
  }

  async function apiSala(metodo, cuerpo) {
    const t = await S.crearToken({
      apiKey: cred.apiKey, apiSecret: cred.apiSecret, sala: evento.sala,
      identidad: 'director-api', horas: 0.1, permisos: { roomAdmin: true, roomCreate: true },
    });
    const base = S.CFG.livekitUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/$/, '');
    const resp = await fetch(base + '/twirp/livekit.RoomService/' + metodo, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.json();
  }

  $('btnTerminar').addEventListener('click', async function () {
    if (!room) return;
    if (!confirm('¿Terminar el evento?\n\nSe desconecta a TODOS: invitados, OBS y este panel. La plataforma deja de consumir.')) return;
    const boton = this;
    boton.disabled = true;
    // 1) Aviso a todos (invitados y OBS) para que se desconecten solos
    try {
      await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ accion: 'terminar' })), { reliable: true, topic: 'sala' });
    } catch (e) { /* seguimos */ }
    // 2) Limpiar el programa
    estado.enVivo = []; estado.destacado = null; estado.cintillo.visible = false;
    S.guardarLocal(CLAVE_ESTADO, estado);
    await new Promise(function (r) { setTimeout(r, 800); });
    // 3) Cerrar la sala en LiveKit (saca a cualquiera que quede)
    try { await apiSala('DeleteRoom', { room: evento.sala }); } catch (e) { /* si falla, ya avisamos a todos */ }
    desconectar();
    boton.disabled = false;
    pintarTextos();
    S.aviso('Evento terminado. No queda nadie conectado.', 'ok', 5000);
  });

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
      if (!S.esParticipanteDeEscena(p)) return;
      S.aviso((p.name || p.identity) + ' salió de la sala', 'mensaje', 3500);
      // Si vuelve a entrar, entra en espera
      if (quitarDelAire(p.identity)) cambio();
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
    r.on(E.Reconnected, function () { pintarConexion('Sala abierta', 'ok'); enviarEstado(); });
    r.on(E.Disconnected, function (motivo) {
      if (room !== r) return; // lo cerramos nosotros
      room = null;
      limpiarAudios();
      pintarConexion('Sala cerrada');
      refrescar();
      pintarRetorno();
      if (motivo === LK.DisconnectReason.DUPLICATE_IDENTITY) S.aviso('El panel se abrió en otra pestaña o computadora. Esta quedó desconectada.', 'error', 8000);
      else if (motivo !== LK.DisconnectReason.CLIENT_INITIATED && motivo !== LK.DisconnectReason.ROOM_DELETED) S.aviso('Se perdió la conexión del panel. Vuelve a abrir la sala.', 'error', 8000);
    });
  }

  /* ------------------------------------------------------------ */
  /* Retorno: hablar a los panelistas (no sale al aire)            */
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
    const yoAlAire = estado.enVivo.indexOf(YO) >= 0;
    $('btnHablar').innerHTML = S.icono(mic ? 'mic' : 'micOff') +
      (mic ? (yoAlAire ? 'Tu micrófono está AL AIRE' : 'Hablando a panelistas') : 'Hablar a panelistas');
    $('btnHablar').classList.toggle('activo', mic && !yoAlAire);
    $('btnHablar').classList.toggle('al-aire', mic && yoAlAire);
    $('btnMiCam').innerHTML = S.icono(cam ? 'cam' : 'camOff') + (cam ? 'Mi cámara visible' : 'Mostrar mi cámara');
    $('btnMiCam').classList.toggle('activo', cam);
    $('btnEscuchar').innerHTML = S.icono(retorno.escuchar ? 'altavoz' : 'micOff') + (retorno.escuchar ? 'Escuchando la sala' : 'Sala en silencio');
    $('btnEscuchar').classList.toggle('encendido', retorno.escuchar);
    $('btnHablar').disabled = !room; $('btnMiCam').disabled = !room;
    $('ayudaRetorno').textContent = yoAlAire
      ? 'Estás AL AIRE: tu voz y tu cámara salen en la transmisión. Quítate del aire en tu tarjeta para volver a hablar solo a los panelistas.'
      : 'Tu voz solo la escuchan los panelistas: no sale en la transmisión. Úsalo para avisarles cuándo empiezan.';
  }

  $('btnHablar').addEventListener('click', async function () {
    if (!room) return;
    try { await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled); }
    catch (e) { S.aviso(S.mensajeDeError(e), 'error'); }
    pintarRetorno(); refrescar();
  });
  $('btnMiCam').addEventListener('click', async function () {
    if (!room) return;
    try { await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled); }
    catch (e) { S.aviso(S.mensajeDeError(e), 'error'); }
    pintarRetorno(); refrescar();
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

  function enviarOrden(identidad, orden) {
    if (!conectado()) return Promise.resolve();
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
    pintarRetorno();
  }

  async function alternarMiAire() {
    if (!room) return;
    if (estado.enVivo.indexOf(YO) >= 0) { alternarAire(YO); return; }
    const lp = room.localParticipant;
    if (!confirm('Vas a salir en la transmisión: tu cámara y tu voz se verán y escucharán en vivo. ¿Continuar?')) return;
    try {
      if (!lp.isCameraEnabled) await lp.setCameraEnabled(true);
      if (!lp.isMicrophoneEnabled) await lp.setMicrophoneEnabled(true);
    } catch (e) { S.aviso(S.mensajeDeError(e), 'error'); }
    alternarAire(YO);
  }

  function destacar(clave) {
    if (estado.enVivo.indexOf(clave) < 0) estado.enVivo.push(clave);
    estado.destacado = clave;
    if (estado.diseno === 'auto' || estado.diseno === 'cuadricula') {
      estado.diseno = /:pantalla$/.test(clave) ? 'presentacion' : 'destacado';
    }
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
    quitarDelAire(p.identity);
    cambio();
    try {
      await apiSala('RemoveParticipant', { room: evento.sala, identity: p.identity });
    } catch (e) {
      await enviarOrden(p.identity, { accion: 'salir' });
    }
  }

  /* ------------------------------------------------------------ */
  /* Cartas de participantes (la tuya primero)                     */
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
    return { el: el, zona: zona, video: video, ini: ini, ins: ins, nombre: nombre, cargo: cargo, acciones: acciones, pista: null, clave: clave };
  }

  function participante(identidad) {
    if (!room) return null;
    if (identidad === S.ID_DIRECTOR) return room.localParticipant;
    return room.remoteParticipants.get(identidad);
  }

  function armarAcciones(c, identidad, tipo) {
    c.acciones.innerHTML = '';
    const clave = c.clave;
    function con(fn) { return function () { const p = participante(identidad); if (p) fn(p); }; }
    if (tipo === 'yo') {
      c.bAire = boton('aire', 'Ponerme al aire', 'aire', alternarMiAire);
      c.bDest = boton('estrella', '', '', function () { destacar(clave); }, 'Destacar (recuadro grande)');
      c.acciones.append(c.bAire, c.bDest,
        boton('cintillo', '', '', con(cintilloDe), 'Mostrar/ocultar tu cintillo grande'),
        boton('editar', '', '', con(editar), 'Tu nombre y cargo en pantalla'));
      return;
    }
    c.bAire = boton('aire', 'Al aire', 'aire', function () { alternarAire(clave); });
    c.bDest = boton('estrella', '', '', function () { destacar(clave); }, 'Destacar (recuadro grande)');
    c.acciones.append(c.bAire, c.bDest);
    if (tipo === 'pantalla') return;
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
      const lista = [room.localParticipant].concat(Array.from(room.remoteParticipants.values()));
      lista.forEach(function (p) {
        const esYo = p === room.localParticipant;
        if (!esYo && !S.esParticipanteDeEscena(p)) return;
        if (!esYo) personas++;
        const n = S.nombreDe(p, estado);
        const cam = p.getTrackPublication(LK.Track.Source.Camera);
        const pan = p.getTrackPublication(LK.Track.Source.ScreenShare);
        const items = [{
          clave: p.identity + ':cam', tipo: esYo ? 'yo' : 'camara',
          pista: cam && cam.track && !cam.isMuted ? cam.track : null,
          nombre: esYo ? 'Tú (' + n.nombre + ')' : n.nombre,
          cargo: esYo ? (n.cargo || 'Producción: no sales al aire salvo que tú quieras') : n.cargo,
        }];
        if (pan && !esYo) items.push({ clave: p.identity + ':pantalla', tipo: 'pantalla', pista: pan.track || null, nombre: 'Pantalla de ' + n.nombre, cargo: 'Pantalla compartida' });

        items.forEach(function (it) {
          vigentes.add(it.clave);
          let c = cartas.get(it.clave);
          if (!c) {
            c = crearCarta(it.clave);
            cartas.set(it.clave, c);
            armarAcciones(c, p.identity, it.tipo);
          }
          ponerEnOrden(caja, c.el, orden++);
          const alAire = estado.enVivo.indexOf(it.clave) >= 0;
          c.el.classList.toggle('al-aire', alAire);
          c.el.classList.toggle('mia', it.tipo === 'yo');
          c.el.classList.toggle('pantalla', it.tipo === 'pantalla');
          c.el.classList.toggle('hablando', it.tipo !== 'pantalla' && p.isSpeaking);
          c.zona.classList.toggle('con-video', !!it.pista);
          c.nombre.textContent = it.nombre;
          c.cargo.textContent = it.cargo || '';
          c.ini.textContent = S.iniciales(n.nombre);
          const textoAire = it.tipo === 'yo' ? (alAire ? 'Quitarme del aire' : 'Ponerme al aire') : (alAire ? 'Quitar del aire' : 'Poner al aire');
          c.bAire.innerHTML = S.icono('aire') + '<span>' + textoAire + '</span>';
          c.bAire.classList.toggle('activo', alAire);
          c.bDest.classList.toggle('encendido', estado.destacado === it.clave);
          c.ins.innerHTML = '';
          const izq = S.crearEl('div', 'fila'); izq.style.gap = '5px';
          if (alAire) izq.append(S.crearEl('span', 'insignia aire', 'AL AIRE'));
          if (it.tipo !== 'pantalla' && !p.isMicrophoneEnabled) izq.append(S.crearEl('span', 'insignia mic-off', 'SIN MIC'));
          const der = S.crearEl('div');
          const q = p.connectionQuality;
          if (it.tipo === 'camara' && (q === LK.ConnectionQuality.Poor || q === LK.ConnectionQuality.Lost)) {
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
    const vacio = $('sinParticipantes');
    vacio.classList.toggle('oculto', personas > 0);
    vacio.textContent = room
      ? 'La sala está abierta. Todavía no entra ningún invitado.'
      : 'Pulsa "Abrir sala" (arriba) cuando quieras que entren los invitados. Mientras la sala esté cerrada, nadie puede entrar ni se consume nada.';
    $('contador').textContent = room ? '(' + personas + (personas === 1 ? ' invitado)' : ' invitados)') : '';
    if (conectado()) pintarConexion('Sala abierta · ' + personas + (personas === 1 ? ' invitado' : ' invitados'), 'ok');
  }

  /* ------------------------------------------------------------ */
  /* Escenas y textos                                              */
  /* ------------------------------------------------------------ */

  Array.prototype.forEach.call($('disenos').querySelectorAll('button'), function (b) {
    b.addEventListener('click', function () { estado.diseno = b.dataset.diseno; cambio(); });
  });

  $('btnTodosFuera').addEventListener('click', function () {
    estado.enVivo = []; estado.destacado = null; cambio(); pintarRetorno();
  });
  $('btnLimpiarGraficos').addEventListener('click', function () {
    estado.cintillo.visible = false; estado.mostrarBanner = false;
    pintarTextos(); cambio();
  });

  function pintarTextos() {
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
    $('selVertical').value = estado.vertical || 'difuminado';
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
  $('selVertical').addEventListener('change', function () { estado.vertical = this.value; cambio(); });

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
      $('btnCintillo').classList.toggle('activo', !!estado.cintillo.visible);
    });
  }

  window.addEventListener('beforeunload', function () { if (room) room.disconnect(); });

  /* ------------------------------------------------------------ */
  /* Inicio                                                        */
  /* ------------------------------------------------------------ */
  pintarClaves();
  pintarEvento();
  pintarInvitados();
  pintarTextos();
  pintarRetorno();
  pintarConexion('Sala cerrada');
  refrescar();
  if (hayClaves() && !evento.obs) generarObs();
})();
