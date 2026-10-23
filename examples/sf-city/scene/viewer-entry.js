// Viewer-only bootstrap. The supported Kite3D runtime owns scene loading, controls,
// resize observation and main({viewer}) cleanup; no editor is instantiated here.
const canvas = document.querySelector('#kite3d-canvas')
const loading = document.querySelector('#loading')
const failure = document.querySelector('#load-error')
const retry = document.querySelector('#retry')
let game = null
let failed = false
let leaving = false

function showFailure(error) {
  failed = true
  loading.hidden = true
  failure.hidden = false
  canvas.setAttribute('aria-hidden', 'true')
  document.body.dataset.viewerState = 'error'
  console.error('Unable to load North Beach', error)
  retry.focus()
}

// A fresh document also clears failed dynamic imports and any interrupted WebGL
// state. It prevents rapid retries from creating overlapping viewers on one canvas.
retry.addEventListener('click', () => {
  retry.disabled = true
  location.reload()
})
canvas.addEventListener('webglcontextlost', () => showFailure(new Error('WebGL context lost')))
window.addEventListener('pagehide', event => {
  if (event.persisted) return
  leaving = true
  void game?.dispose().catch(error => console.error('Viewer cleanup failed', error))
  game = null
})

async function boot() {
  document.body.dataset.viewerState = 'loading'
  try {
    const {createGame} = await import('./_blitz/runtime.js')
    const created = await createGame({
      base: new URL('./', location.href).href,
      canvas,
      renderDuringLoad: false,
      onError: showFailure,
    })
    if (leaving || failed) {
      await created.dispose()
      return
    }
    game = created
    loading.hidden = true
    canvas.removeAttribute('aria-hidden')
    document.body.dataset.viewerState = 'ready'
    canvas.focus({preventScroll: true})
  } catch (error) {
    if (!leaving) showFailure(error)
  }
}
void boot()
