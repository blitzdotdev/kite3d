// Diagnostic full-baseline fixture. No geographic subset is silently discarded.
import {Group, DirectionalLight, DirectionalLight2, SSAOPlugin} from 'threepipe'
import {createKiteTileAdapter} from './lib/tile-streaming.js'
import {createStaticTilePreflight} from './lib/tile-preflight.js'
import {createTileMaterialPool} from './lib/tile-material-pool.js'
let inspect = () => ({stage:'not-started'}), draw = () => {}, release = async () => {}
export const inspectProfile = () => inspect()
export const renderProfileFrame = () => draw()
export const releaseProfile = () => release()
export async function main({viewer}) {
  const started = performance.now(), base = new URL('./',import.meta.url)
  const read = async path => { const r=await fetch(new URL(path,base)); if(!r.ok) throw Error(`${path}: ${r.status}`); return r.json() }
  const [manifest, profile, generated] = await Promise.all(['manifest.json','profile.json','scene/generated.json'].map(read))
  const root=new Group(), pins=new Group(), lights=new Group(); viewer.scene.add(root,pins,lights)
  const pool=createTileMaterialPool(), abort=new AbortController(), handles=[]
  let preflight, adapter, pinnedAdapter, stage='preparing', error, task=Promise.resolve(), stopped=false
  let frames=0, lastFrame={}, totals, inFrame=false, frameStart=0
  const groupMeasurements=[], stages={}, peaks={geometries:0,textures:0,loaded:0}, samples=[]
  const renderer=viewer.renderManager.webglRenderer, info=renderer.info, originalReset=info.reset
  const add=()=>{for(const k of ['calls','triangles','lines','points']) totals[k]+=info.render[k]||0}
  info.reset=function(){if(inFrame)add(); originalReset.call(info)}
  const before=()=>{inFrame=false;originalReset.call(info);totals={calls:0,triangles:0,lines:0,points:0};frameStart=performance.now();inFrame=true}
  const after=()=>{if(!inFrame)return;add();inFrame=false;if(!totals.calls)return;frames++;lastFrame={...totals,cpuFrameMs:performance.now()-frameStart};for(const k of ['geometries','textures'])peaks[k]=Math.max(peaks[k],info.memory[k]);if(stage==='ready'&&samples.length<20)samples.push({...lastFrame})}
  viewer.addEventListener('preFrame',before);viewer.addEventListener('postFrame',after)
  draw=()=>{viewer.setDirty();return frames}
  inspect=()=>({stage,error,frames,stages:{...stages},loaded:handles.length,expected:profile.groups+1,peaks:{...peaks},memory:{...info.memory},lastFrame:{...lastFrame},samples:[...samples],groupMeasurements:[...groupMeasurements],pool:{...pool.state},sources:adapter?.state,pinned:pinnedAdapter?.state,profile})
  const status=()=>{document.querySelector('#status').textContent=`${stage}: ${handles.length}/${profile.groups+1} groups\n${error||''}`}
  const camera=viewer.scene.mainCamera;camera.position.set(320,300,400);camera.target.set(0,20,0);camera.lookAt(camera.target);camera.setDirty()
  release=async()=>{
    if(stopped)return task
    stopped=true;abort.abort();await task.catch(()=>{})
    for(const {adapter:a,handle} of handles.splice(0))a.release(handle)
    pool.dispose();preflight?.dispose();stage='released';status();viewer.setDirty()
  }
  const leaving=()=>{void release()};window.addEventListener('pagehide',leaving)
  try {
    await viewer.setEnvironmentMap(new URL('assets/environments/grant-street/street.hdr',base).href)
    viewer.scene.environmentRotation.y=generated.photoStudies?.[0]?.yaw||0
    const sun=new DirectionalLight2('#fff',3.2);sun.position.set(-180,270,190);sun.castShadow=true;sun.shadowMapSize.set(2048,2048);sun.shadowFrustum=640;sun.shadowBias=-.0002;sun.shadowNormalBias=640/2048*1.2;sun.shadowNear=1;sun.shadowFar=1020;lights.add(sun)
    for(const [color,intensity,pos] of [[0xffefd6,.625,[-1,2,-1]],[0xb8d4ff,.3,[1,1,1]],[0xdbe6ff,.125,[-1,1,1]]]){const l=new DirectionalLight(color,intensity);l.position.set(...pos);lights.add(l)}
    const ao=await viewer.addPlugin(SSAOPlugin);ao.pass.intensity=.35;ao.pass.occlusionWorldRadius=1.2;viewer.timeline.endTime=0
    preflight=await createStaticTilePreflight(manifest,base,viewer.assetManager.importer)
    adapter=createKiteTileAdapter(viewer,manifest,root,{...preflight,materialPool:pool,batch:true,batchCellSize:profile.batchCellSize})
    pinnedAdapter=createKiteTileAdapter(viewer,manifest,pins,{...preflight,validateFeature:preflight.validatePinnedFeature,materialPool:pool})
    stages.preflightMs=performance.now()-started
    const jobs=[{id:'pinned',tile:{featureIds:manifest.pinnedFeatureIds},adapter:pinnedAdapter},...Object.entries(manifest.tiles).map(([id,tile])=>({id,tile:{...tile,detail:'far'},adapter}))]
    // Two private imports at most. This profiles the whole attested fixture;
    // these source bounds are not proposed production memory limits.
    let cursor=0
    const worker=async()=>{
      while(cursor<jobs.length&&!abort.signal.aborted){const job=jobs[cursor++];const h=await job.adapter.load(job.id,job.tile,abort.signal)
        if(abort.signal.aborted){job.adapter.release(h);break}
        let units=0;h.root.traverseVisible(n=>{if(n.isMesh)units+=Array.isArray(n.material)?n.geometry.groups.length:1});groupMeasurements.push({id:job.id,detail:job.tile.detail||'original',features:job.tile.featureIds.length,drawUnits:units,conservativePassUnits:units*4,batchCellSize:profile.batchCellSize});job.adapter.attach(h);handles.push({adapter:job.adapter,handle:h});peaks.loaded=Math.max(peaks.loaded,handles.length);status();viewer.setDirty()
      }
    }
    stage='loading';status()
    const guardedWorker=()=>worker().catch(e=>{abort.abort();throw e})
    task=Promise.allSettled([guardedWorker(),guardedWorker()]).then(results=>{
      const failed=results.find(result=>result.status==='rejected')
      if(failed)throw failed.reason
      if(abort.signal.aborted)return
      if(handles.length!==jobs.length)throw Error('Incomplete baseline')
      root.updateMatrixWorld(true);stage='ready';stages.baselineLoadMs=performance.now()-started;status();viewer.setDirty()
    }).catch(e=>{error=e.message;stage='error';abort.abort();status();throw e})
    void task.catch(()=>{})
  } catch(e) {error=e.message;stage='error';await release();throw e}
  return async()=>{await release();window.removeEventListener('pagehide',leaving);viewer.removeEventListener('preFrame',before);viewer.removeEventListener('postFrame',after);info.reset=originalReset;root.removeFromParent();pins.removeFromParent();lights.removeFromParent();draw=()=>{}}
}
