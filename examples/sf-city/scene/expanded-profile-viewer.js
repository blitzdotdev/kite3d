const boot=document.querySelector('#boot'), canvas=document.querySelector('canvas')
let game, leaving=false
const fail=e=>{boot.textContent=e.message;document.body.dataset.viewerState='error';console.error(e)}
document.querySelector('#reload').onclick=()=>location.reload()
document.querySelector('#dispose').onclick=async()=>{const main=await import('./main.js');await main.releaseProfile()}
window.addEventListener('pagehide',()=>{leaving=true;void game?.dispose()})
try {
  const {createGame}=await import('./_blitz/runtime.js')
  game=await createGame({base:new URL('./',location.href).href,canvas,renderDuringLoad:false,onError:fail})
  if(leaving)await game.dispose()
  else {boot.textContent='Loading complete context; profiling only.';document.body.dataset.viewerState='ready'}
}catch(e){fail(e)}
