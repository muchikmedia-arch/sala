/*
 * Sala Muchik - configuración
 * ---------------------------------------------------------------
 * Aquí NO va el "API Secret". El secreto se escribe solo en el
 * panel del director y se guarda únicamente en el navegador de tu PC.
 */
window.SALA_CONFIG = {
  // Dirección de tu proyecto en LiveKit Cloud (Settings > General > Project URL)
  livekitUrl: 'wss://sala-muchik-k6zmzoic.livekit.cloud',

  // Dirección pública donde quedan estas páginas (GitHub Pages).
  // Déjalo vacío ('') y se detecta solo. Ejemplo:
  // 'https://muchikmedia-arch.github.io/sala/'
  urlPublica: '',

  nombrePlataforma: 'Sala Muchik',
  credito: 'Muchik Media | Apps',
  web: 'www.muchikmedia.com',
  ciudad: 'Trujillo - Perú',

  // Colores por defecto de los gráficos (luego se cambian desde el panel)
  colorMarca: '#e3001b',
  colorFondo: '#0f1419',
};
