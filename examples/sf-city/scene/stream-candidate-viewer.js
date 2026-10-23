// Isolated experimental entry. Uses Kite3D createGame, never an editor or a second viewer.
const canvas = document.querySelector('canvas'), status = document.querySelector('#boot')
let game, leaving = false
function fail(error) {
  status.hidden = false
  status.textContent = 'Candidate could not load. Reload to retry. ' + error.message
  document.body.dataset.viewerState = 'error'
  console.error(error)
}
document.querySelector('#reload').onclick = () => location.reload()
window.addEventListener('pagehide', () => { leaving = true; void game?.dispose() })
canvas.addEventListener('webglcontextlost', () => fail(new Error('WebGL context lost')))
try {
  const {createGame} = await import('./_blitz/runtime.js')
  game = await createGame({base: new URL('./', location.href).href, canvas, renderDuringLoad: false, onError: fail})
  if (leaving) await game.dispose()
  else { status.hidden = true; document.body.dataset.viewerState = 'ready'; canvas.focus() }
} catch (error) { fail(error) }
