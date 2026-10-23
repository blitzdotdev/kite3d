// Experimental executor for complete-context admission. Source eligibility and
// representation costs must be attested before update(); source edits require a
// new frozen manifest/runtime. Existing releases do not import this module.
import {planNeighborhoodAdmission} from './neighborhood-admission.js'

export function createNeighborhoodRuntime(manifest, adapter, options) {
  const policyOptions = structuredClone(options)
  const active = new Map(), pending = new Map(), failed = new Map(), identities = new Map()
  let baseline = [], promotions = [], stopped = false, stopPromise, lastPlan
  const copy = entry => ({id: entry.id, key: entry.key, detail: entry.detail, cost: {...entry.cost},
    ...(entry.distance === undefined ? {} : {distance: entry.distance})})
  const plan = (required = baseline, detail = promotions) => planNeighborhoodAdmission({
    ...policyOptions, baseline: required, promotions: detail,
    active: [...active.values()].map(item => item.representation),
    // Aborted requests remain here until their import/pool cleanup finishes.
    pending: [...pending.values()].map(item => item.representation),
  })
  function release(handle) {
    try { adapter.detach?.(handle) } finally { adapter.release(handle) }
  }
  function pump() {
    if (stopped || !baseline.length) return
    lastPlan = plan()
    for (const key of lastPlan.cancelPending ?? []) {
      for (const item of pending.values()) if (item.representation.key === key) item.abort.abort()
    }
    const releaseKeys = new Set(lastPlan.releaseAfterBaselineReady ?? [])
    for (const [id, item] of active) if (releaseKeys.has(item.representation.key)) {
      active.delete(id); release(item.handle)
    }
    if (releaseKeys.size) lastPlan = plan()
    for (const requested of lastPlan.starts) {
      if (failed.has(requested.key) || pending.has(requested.id)) continue
      const representation = copy(requested)
      const item = {representation, abort: new AbortController(), handle: null, done: null}
      pending.set(representation.id, item)
      // Defer the actual call so a synchronous importer failure has the same
      // cleanup/accounting path as an asynchronous import or pool failure.
      item.done = Promise.resolve().then(() => adapter.load(representation.id,
        {...manifest.tiles[representation.id], detail: representation.detail}, item.abort.signal)).then(handle => {
        item.handle = handle
        if (stopped || item.abort.signal.aborted || pending.get(representation.id) !== item) return
        const latest = plan(), wanted = latest.desired.find(entry => entry.id === representation.id)
        const required = baseline.find(entry => entry.id === representation.id)
        if (!wanted || latest.status === 'blocked-neighborhood-transition' || latest.status === 'baseline-over-budget') return
        // A missing group may finish its required baseline before promotion. An
        // existing group only swaps to the exact currently desired representation.
        if (active.has(representation.id) ? wanted.key !== representation.key : required?.key !== representation.key) return
        const previous = active.get(representation.id)
        adapter.attach(handle)
        active.set(representation.id, {representation, handle})
        item.handle = null
        pending.delete(representation.id)
        if (previous) release(previous.handle)
      }).catch(error => {
        if (!item.abort.signal.aborted && !stopped) failed.set(representation.key, {id: representation.id, message: String(error.message ?? error)})
      }).finally(() => {
        if (item.handle) release(item.handle)
        if (pending.get(representation.id) === item) pending.delete(representation.id)
        if (!stopped) pump()
      })
    }
  }
  return {
    update(required, detail = []) {
      if (stopped) throw Error('Neighborhood runtime stopped')
      const nextBaseline = required.map(copy), nextPromotions = detail.map(copy)
      // Invalid requests leave the existing neighborhood and pending work intact.
      plan(nextBaseline, nextPromotions)
      for (const entry of [...nextBaseline, ...nextPromotions]) {
        if (!manifest.tiles[entry.id]) throw Error(`Unknown runtime coverage group: ${entry.id}`)
        const identity = JSON.stringify({id: entry.id, key: entry.key, detail: entry.detail, cost: entry.cost})
        const slot = `${entry.id}/${entry.detail}`
        if (identities.has(slot) && identities.get(slot) !== identity) throw Error(`Representation identity/cost changed: ${slot}`)
      }
      for (const entry of [...nextBaseline, ...nextPromotions]) {
        identities.set(`${entry.id}/${entry.detail}`, JSON.stringify({id: entry.id, key: entry.key, detail: entry.detail, cost: entry.cost}))
      }
      baseline = nextBaseline; promotions = nextPromotions
      const permitted = new Set([...baseline, ...promotions].map(entry => entry.key))
      for (const item of pending.values()) if (!permitted.has(item.representation.key)) item.abort.abort()
      for (const key of failed.keys()) if (!permitted.has(key)) failed.delete(key)
      pump()
    },
    retry(key) {
      if (stopped) return
      if (key === undefined) failed.clear()
      else failed.delete(key)
      pump()
    },
    stop() {
      if (stopPromise) return stopPromise
      stopped = true
      for (const item of pending.values()) item.abort.abort()
      // Stop removes visible content immediately, but its promise does not claim
      // completion while cancelled importer/pool work still owns resources.
      for (const item of active.values()) release(item.handle)
      active.clear()
      stopPromise = Promise.allSettled([...pending.values()].map(item => item.done)).then(() => { failed.clear() })
      return stopPromise
    },
    get state() {
      const current = baseline.length ? plan() : undefined
      return {stopped, active: [...active.values()].map(item => copy(item.representation)),
        pending: [...pending.values()].map(item => ({...copy(item.representation), cancelled: item.abort.signal.aborted})),
        errors: Object.fromEntries(failed), admission: current ?? lastPlan}
    },
  }
}
