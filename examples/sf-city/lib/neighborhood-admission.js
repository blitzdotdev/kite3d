// Experimental pure policy for the observed nearest-chunk holes. This does not
// load assets or alter the tested controller. Costs must be attested externally.
// Every required baseline survives promotion selection; it is never a nearest-N list.
export function planNeighborhoodAdmission({baseline, promotions = [], pinnedCost, activeLimits, reservationLimits, active = [], pending = [], maxConcurrentLoads = 2}) {
  const fields = ['triangles', 'bytes', 'drawCalls']
  const cost = (value, label) => {
    if (!value || fields.some(key => !Number.isFinite(value[key]) || value[key] < 0)) throw Error(`Invalid ${label} cost`)
    return Object.fromEntries(fields.map(key => [key, value[key]]))
  }
  const pinned = cost(pinnedCost, 'pinned')
  for (const [label, limits] of [['active', activeLimits], ['reservation', reservationLimits]]) {
    cost(limits, label)
    if (!Number.isSafeInteger(limits.entries) || limits.entries < 0) throw Error(`Invalid ${label} entry limit`)
  }
  if (activeLimits.entries > reservationLimits.entries || fields.some(key => activeLimits[key] > reservationLimits[key])) throw Error('Active limits exceed reservation limits')
  if (!Number.isSafeInteger(maxConcurrentLoads) || maxConcurrentLoads < 1) throw Error('Invalid concurrent load limit')
  const normalize = (entry, label) => {
    if (!entry || typeof entry.id !== 'string' || !entry.id || typeof entry.key !== 'string' || !entry.key || !['far', 'mid', 'near'].includes(entry.detail)) throw Error(`Invalid ${label} representation`)
    return {...entry, cost: cost(entry.cost, label)}
  }
  const required = baseline.map(entry => normalize(entry, 'baseline'))
  const requiredById = new Map(required.map(entry => [entry.id, entry]))
  if (!required.length || requiredById.size !== required.length) throw Error('Baseline must contain unique required coverage groups')
  const current = active.map(entry => normalize(entry, 'active')), loading = pending.map(entry => normalize(entry, 'pending'))
  if (new Set(current.map(entry => entry.id)).size !== current.length) throw Error('Multiple active representations for one coverage group')
  if (new Set(loading.map(entry => entry.id)).size !== loading.length || new Set([...current, ...loading].map(entry => entry.key)).size !== current.length + loading.length) throw Error('Duplicate active/pending representation identity')
  const sum = entries => ({...Object.fromEntries(fields.map(key => [key, pinned[key] + entries.reduce((total, entry) => total + entry.cost[key], 0)])), entries: entries.length})
  const fits = (total, limits) => total.entries <= limits.entries && fields.every(key => total[key] <= limits[key])
  const baselineCost = sum(required), reservedCost = sum([...current, ...loading])
  if (!fits(sum(current), activeLimits)) throw Error('Existing active coverage exceeds active limits')
  if (!fits(baselineCost, activeLimits)) return {
    status: 'baseline-over-budget', baselineCost, reservedCost, desired: [], starts: [],
    retain: current.map(entry => entry.key), missingBaseline: required.map(entry => entry.id),
    deferred: [{reason: 'Complete required neighborhood does not fit; retain the previous neighborhood instead of creating holes.'}],
  }
  const desired = new Map(required.map(entry => [entry.id, entry])), deferred = []
  const ranked = promotions.map(entry => normalize(entry, 'promotion')).sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id) || a.key.localeCompare(b.key))
  const promoted = new Set()
  for (const entry of ranked) {
    if (!requiredById.has(entry.id) || !Number.isFinite(entry.distance) || entry.distance < 0) throw Error('Promotion is outside required coverage or has invalid distance')
    if (promoted.has(entry.id)) continue
    const trial = [...desired.values()].map(old => old.id === entry.id ? entry : old)
    if (fits(sum(trial), activeLimits)) { desired.set(entry.id, entry); promoted.add(entry.id) }
    else deferred.push({id: entry.id, key: entry.key, reason: 'active-budget', retainedBaseline: requiredById.get(entry.id).key})
  }
  const currentById = new Map(current.map(entry => [entry.id, entry]))
  const pendingById = new Map(loading.map(entry => [entry.id, entry]))
  const missingBaseline = required.filter(entry => !currentById.has(entry.id)).map(entry => entry.id)
  const foreign = current.filter(entry => !requiredById.has(entry.id))
  if (foreign.length && missingBaseline.length) {
    const completeOverlapCost = sum([...current, ...loading, ...required.filter(entry => !currentById.has(entry.id) && !pendingById.has(entry.id))])
    return {
      status: 'blocked-neighborhood-transition', baselineCost, reservedCost, desired: [...desired.values()], starts: [],
      retain: current.map(entry => entry.key), missingBaseline, deferred,
      transition: {requiresAtomicCoverageSwap: true, completeOverlapCost, fitsReservation: fits(completeOverlapCost, reservationLimits)},
    }
  }
  const rank = {far: 0, mid: 1, near: 2}
  // Cover missing groups at baseline detail before spending any overlap reserve
  // on optional promotions. Existing representations remain attached until swap.
  const requests = [
    ...required.filter(entry => !currentById.has(entry.id)),
    ...[...desired.values()].filter(entry => currentById.has(entry.id) && currentById.get(entry.id).key !== entry.key)
      .sort((a, b) => (rank[a.detail] - rank[currentById.get(a.id).detail]) - (rank[b.detail] - rank[currentById.get(b.id).detail]) || a.id.localeCompare(b.id)),
  ]
  const starts = [], held = [...current, ...loading]
  // Never credit a pending demotion before its actual swap. Componentwise maxima
  // cover either completion order for concurrently loaded missing groups.
  const possibleActive = new Map(current.map(entry => [entry.id, entry]))
  const accountIncoming = entry => {
    const old = possibleActive.get(entry.id)
    possibleActive.set(entry.id, old ? {...entry, cost: Object.fromEntries(fields.map(key => [key, Math.max(old.cost[key], entry.cost[key])]))} : entry)
  }
  for (const entry of loading) accountIncoming(entry)
  let replacementInFlight = loading.some(entry => currentById.has(entry.id))
  for (const entry of requests) {
    if (pendingById.has(entry.id)) continue
    const replacement = currentById.has(entry.id)
    if (replacement && (missingBaseline.length || replacementInFlight)) {
      deferred.push({id: entry.id, key: entry.key, reason: missingBaseline.length ? 'baseline-loading' : 'replacement-in-flight'})
      continue
    }
    const previous = possibleActive.get(entry.id)
    accountIncoming(entry)
    const activeSwapFits = fits(sum([...possibleActive.values()]), activeLimits)
    if (previous) possibleActive.set(entry.id, previous)
    else possibleActive.delete(entry.id)
    if (!activeSwapFits) {
      deferred.push({id: entry.id, key: entry.key, reason: 'active-swap-budget', retain: currentById.get(entry.id)?.key})
      continue
    }
    if (loading.length + starts.length >= maxConcurrentLoads || !fits(sum([...held, entry]), reservationLimits)) {
      deferred.push({id: entry.id, key: entry.key, reason: 'reservation-budget', retain: currentById.get(entry.id)?.key})
      continue
    }
    starts.push(entry); held.push(entry)
    accountIncoming(entry)
    if (replacement) replacementInFlight = true
  }
  return {
    status: missingBaseline.length ? 'baseline-loading' : 'ready', baselineCost, activeCost: sum([...desired.values()]),
    // "ready" means context is present, not that all requested detail is ready.
    baselineComplete: missingBaseline.length === 0,
    detailComplete: !loading.length && [...desired.values()].every(entry => currentById.get(entry.id)?.key === entry.key),
    reservedCost, plannedReservationCost: sum(held), desired: [...desired.values()], starts,
    retain: current.map(entry => entry.key), missingBaseline, deferred,
    releaseAfterBaselineReady: missingBaseline.length ? [] : foreign.map(entry => entry.key),
    cancelPending: loading.filter(entry => !requiredById.has(entry.id) || (currentById.has(entry.id) && desired.get(entry.id)?.key !== entry.key)).map(entry => entry.key),
  }
}
