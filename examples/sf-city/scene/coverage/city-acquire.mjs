// Bounded, immutable source paging. This does not generate or render city geometry.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { coveragePlan } from './plan.mjs'
const directory = dirname(fileURLToPath(import.meta.url)),
  hash = (b) => createHash('sha256').update(b).digest('hex'),
  specs = coveragePlan().acquisition.datasets
const PAGE_ROWS = 5000,
  MAX_BYTES = 32 * 1024 * 1024
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const query = (layer, select, extra = {}) => {
  const p = new URLSearchParams({
    $select: select,
    ...(layer === 'roads' ? { $where: 'active = true' } : {}),
    ...extra,
  })
  return `https://data.sf.gov/resource/${specs[layer].id}.json?${p}`
}
const headers = (response) =>
  Object.fromEntries(
    [
      'last-modified',
      'etag',
      'retry-after',
      'x-socrata-requestid',
      'x-soda2-fields',
      'x-soda2-types',
      'content-type',
    ].map((k) => [k, response.headers.get(k)]),
  )
function retryAt(value, now) {
  if (value == null) return now + 30000
  const at = /^\d+$/.test(value.trim()) ? now + Number(value) * 1000 : Date.parse(value)
  return Number.isFinite(at) ? at : now + 30000
}
export async function captureBatch({
  output = resolve(directory, 'captures/citywide'),
  resume,
  maxPages = 8,
  fetchEnabled = false,
} = {}) {
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 8)
    throw new Error('Page budget must be 1 to 8')
  if (!fetchEnabled)
    return {
      mode: 'dry-run',
      maxDataPages: maxPages,
      pageRows: PAGE_ROWS,
      maxConcurrentLayers: 2,
      maxResponseBytes: MAX_BYTES,
      layers: Object.keys(specs),
      networkRequests: 0,
    }
  const startedAt = new Date().toISOString(),
    id = startedAt.replaceAll(':', '-') + '-' + randomUUID(),
    staging = resolve(output, '.staging-' + id),
    destination = resolve(output, id),
    previous = resume
      ? JSON.parse(await readFile(resolve(resume, 'batch-manifest.json'), 'utf8'))
      : null
  if (previous && !['partial', 'complete'].includes(previous.status))
    throw new Error('Cannot resume an inconsistent or failed capture')
  if (previous?.pageRows !== undefined && previous.pageRows !== PAGE_ROWS)
    throw new Error('Resume page size mismatch')
  await mkdir(staging, { recursive: true })
  const sourceProvenanceBytes = await readFile(resolve(directory, '../sources/provenance.json')),
    sourceProvenance = JSON.parse(sourceProvenanceBytes)
  const attribution = {
    publisher: sourceProvenance.publisher,
    licenseURL: sourceProvenance.license,
    verification:
      'Inherited from accepted snapshot provenance; not independently reverified in this batch',
    acceptedProvenanceSHA256: hash(sourceProvenanceBytes),
  }
  const layers = {},
    requests = [],
    names = Object.keys(specs),
    quotas = Object.fromEntries(names.map((name) => [name, 0]))
  // Reserve at most the remaining data pages plus one terminal-empty check.
  // Completed layers keep watermark checks but consume no data-page quota.
  const remainingPages = Object.fromEntries(
    names.map((name) => {
      const prior = previous?.layers[name]
      return [
        name,
        prior?.status === 'complete'
          ? 0
          : prior
            ? Math.ceil(Math.max(0, prior.start.count - prior.rowsTotal) / PAGE_ROWS) + 1
            : maxPages,
      ]
    }),
  )
  let allocated = 0
  while (allocated < maxPages) {
    let progressed = false
    for (const name of names) {
      if (allocated === maxPages) break
      if (quotas[name] >= remainingPages[name]) continue
      quotas[name]++
      allocated++
      progressed = true
    }
    if (!progressed) break
  }
  let cursor = 0,
    stop = false,
    dataPagesRequested = 0
  async function request(url, kind, layer) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (stop)
        throw Object.assign(new Error('Batch stopped after a failure or access restriction'), {
          state: 'stopped',
        })
      const startedAt = new Date().toISOString()
      let response
      try {
        response = await fetch(url, {
          redirect: 'error',
          signal: AbortSignal.timeout(90000),
          headers: { 'User-Agent': 'Kite3D-SF-bounded-city-capture/1.0' },
        })
      } catch (error) {
        requests.push({
          layer,
          kind,
          url,
          attempt,
          startedAt,
          status: null,
          error: error.message,
          transportErrorCode: error.cause?.code ?? null,
        })
        throw error
      }
      const record = {
        layer,
        kind,
        url,
        attempt,
        startedAt,
        receivedAt: new Date().toISOString(),
        status: response.status,
        headers: headers(response),
      }
      requests.push(record)
      if ([401, 403, 429].includes(response.status)) {
        stop = true
        await response.body?.cancel()
        throw Object.assign(new Error('HTTP ' + response.status), { state: 'denied' })
      }
      if (response.status === 503 && attempt === 0) {
        await response.body?.cancel()
        const at = retryAt(record.headers['retry-after'], Date.now()),
          delay = Math.max(0, at - Date.now())
        record.retryNotBefore = new Date(at).toISOString()
        if (delay > 60000)
          throw Object.assign(new Error('503 retry requires later batch after Retry-After'), {
            state: 'deferred',
          })
        await wait(delay)
        continue
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw Object.assign(new Error('HTTP ' + response.status), { state: 'failed' })
      }
      const reader = response.body?.getReader()
      if (!reader) throw new Error('Missing response body')
      const parts = []
      let bytes = 0
      while (true) {
        const r = await reader.read()
        if (r.done) break
        bytes += r.value.byteLength
        if (bytes > MAX_BYTES) {
          await reader.cancel()
          throw Object.assign(new Error('Response exceeds 32 MiB'), { state: 'oversized' })
        }
        parts.push(r.value)
      }
      const payload = Buffer.concat(parts)
      record.bytes = bytes
      record.sha256 = hash(payload)
      return { payload, record }
    }
  }
  async function count(layer) {
    const r = await request(query(layer, 'count(*) as count', { $limit: '1' }), 'count', layer),
      rows = JSON.parse(r.payload)
    const count = Number(rows[0]?.count)
    if (!Array.isArray(rows) || rows.length !== 1 || !Number.isSafeInteger(count) || count < 0)
      throw new Error('Invalid count response')
    const modified = r.record.headers['last-modified']
    if (!modified || !Number.isFinite(Date.parse(modified)))
      throw new Error('Missing usable Last-Modified watermark')
    return {
      count,
      lastModified: modified,
      etag: r.record.headers.etag,
      query: r.record.url,
      capturedAt: r.record.receivedAt,
    }
  }
  async function layerWorker() {
    while (cursor < names.length && !stop) {
      const layer = names[cursor++],
        prior = previous?.layers[layer],
        state = (layers[layer] = {
          dataset: specs[layer].id,
          provenance: {
            datasetURL: `https://data.sf.gov/d/${specs[layer].id}`,
            resourceURL: `https://data.sf.gov/resource/${specs[layer].id}.json`,
            semanticIDField: specs[layer].key,
            selectedFields: specs[layer].fields,
            systemFields: { capture_row_id: ':id', capture_updated_at: ':updated_at' },
            filter: layer === 'roads' ? 'active = true' : null,
            attribution,
          },
          requestedOrder: ':id ASC',
          orderValidation:
            'Server order requested; uniqueness, offsets, counts and watermarks checked. Encoded row identifiers are not compared lexicographically.',
          status: 'partial',
          pageRows: PAGE_ROWS,
          priorBatch: prior
            ? {
                captureId: previous.captureId,
                manifestPath: resolve(resume, 'batch-manifest.json'),
                manifestSHA256: hash(
                  await readFile(resolve(resume, 'batch-manifest.json'), 'utf8'),
                ),
              }
            : null,
          offset: prior?.nextOffset ?? 0,
          nextOffset: prior?.nextOffset ?? 0,
          rowsPreviouslyCaptured: prior?.rowsTotal ?? 0,
          rowsThisBatch: 0,
          rowsTotal: prior?.rowsTotal ?? 0,
          rawBytesThisBatch: 0,
          pages: [],
          terminalEmpty: prior?.terminalEmpty ?? false,
          geometryValidation: 'deferred; raw source records preserved, no geometry accepted',
        })
      try {
        if (prior && prior.dataset !== specs[layer].id) throw new Error('Resume dataset mismatch')
        state.start = await count(layer)
        const watermark = prior?.start ?? state.start
        if (
          state.start.count !== watermark.count ||
          state.start.lastModified !== watermark.lastModified
        )
          throw Object.assign(
            new Error('Dataset changed since previous capture; begin a new chain'),
            { state: 'inconsistent' },
          )
        const seen = new Set()
        // Validate all ancestor payload hashes and IDs before trusting offsets.
        async function scanPrior(folder, manifest) {
          const p = manifest.layers[layer]
          if (!p) return
          if (p.priorBatch) {
            const bytes = await readFile(p.priorBatch.manifestPath)
            if (hash(bytes) !== p.priorBatch.manifestSHA256)
              throw new Error('Ancestor manifest hash mismatch')
            await scanPrior(dirname(p.priorBatch.manifestPath), JSON.parse(bytes))
          }
          for (const page of p.pages ?? []) {
            const bytes = await readFile(resolve(folder, page.file))
            if (hash(bytes) !== page.sha256) throw new Error('Ancestor page hash mismatch')
            for (const row of JSON.parse(bytes)) {
              const id = row.capture_row_id
              if (id == null || seen.has(String(id)))
                throw new Error('Invalid or duplicate ancestor row ID')
              seen.add(String(id))
            }
          }
        }
        if (previous) await scanPrior(resolve(resume), previous)
        if (seen.size !== state.rowsPreviouslyCaptured) throw new Error('Resume row count mismatch')
        for (let page = 0; page < quotas[layer] && !state.terminalEmpty; page++) {
          const select = [
              ':id as capture_row_id',
              ':updated_at as capture_updated_at',
              ...specs[layer].fields,
            ].join(','),
            url = query(layer, select, {
              $order: ':id ASC',
              $limit: String(PAGE_ROWS),
              $offset: String(state.nextOffset),
            })
          dataPagesRequested++
          const result = await request(url, 'data-page', layer),
            file = `${layer}-${String(state.nextOffset).padStart(9, '0')}.json`
          // Preserve bytes even if validation fails. Failed batches never become accepted snapshots.
          await writeFile(resolve(staging, file), result.payload, { flag: 'wx' })
          const item = {
            file,
            offset: state.nextOffset,
            sha256: hash(result.payload),
            bytes: result.payload.length,
            url,
            headers: result.record.headers,
            status: 'unvalidated',
          }
          state.pages.push(item)
          state.rawBytesThisBatch += item.bytes
          const rows = JSON.parse(result.payload)
          if (!Array.isArray(rows) || rows.length > PAGE_ROWS)
            throw new Error('Invalid page record array')
          if (result.record.headers['last-modified'] !== state.start.lastModified)
            throw Object.assign(new Error('Dataset watermark changed during paging'), {
              state: 'inconsistent',
            })
          for (const row of rows) {
            if (
              !row ||
              typeof row !== 'object' ||
              Array.isArray(row) ||
              !['string', 'number'].includes(typeof row.capture_row_id) ||
              String(row.capture_row_id).trim() === '' ||
              row.capture_updated_at == null
            )
              throw new Error('Missing system row identity or update timestamp')
            const id = String(row.capture_row_id)
            if (seen.has(id)) throw new Error('Duplicate system row ID across pages')
            seen.add(id)
          }
          const expected = Math.min(PAGE_ROWS, Math.max(0, state.start.count - state.nextOffset))
          if (rows.length !== expected)
            throw Object.assign(new Error('Page length disagrees with initial count'), {
              state: 'inconsistent',
            })
          state.schemaEvidence = {
            fields: result.record.headers['x-soda2-fields'],
            types: result.record.headers['x-soda2-types'],
            source: 'SODA response headers; raw header strings retained',
          }
          item.status = 'validated-source-rows'
          item.rows = rows.length
          item.firstRowId = rows[0]?.capture_row_id ?? null
          item.lastRowId = rows.at(-1)?.capture_row_id ?? null
          state.rowsThisBatch += rows.length
          state.rowsTotal += rows.length
          state.nextOffset += rows.length
          state.terminalEmpty = rows.length === 0
        }
        state.end = await count(layer)
        if (
          state.end.count !== state.start.count ||
          state.end.lastModified !== state.start.lastModified
        )
          throw Object.assign(new Error('Dataset changed across batch'), { state: 'inconsistent' })
        state.status =
          state.terminalEmpty && state.rowsTotal === state.start.count ? 'complete' : 'partial'
      } catch (error) {
        state.status = error.state ?? 'failed'
        stop = true
        state.error = error.message
      }
    }
  }
  await Promise.all([layerWorker(), layerWorker()])
  for (const name of names)
    layers[name] ??= {
      dataset: specs[name].id,
      status: 'not-started',
      error: 'Batch stopped before layer began',
    }
  const acceptable = Object.values(layers).every((l) => ['partial', 'complete'].includes(l.status)),
    complete = Object.values(layers).every((l) => l.status === 'complete'),
    manifest = {
      version: 1,
      captureId: id,
      status: acceptable ? (complete ? 'complete' : 'partial') : 'failed',
      consistency: 'observational watermark/count checks, not a transactional snapshot',
      startedAt,
      completedAt: new Date().toISOString(),
      pageRows: PAGE_ROWS,
      maxDataPages: maxPages,
      dataPagesRequested,
      maxConcurrentLayers: 2,
      maxResponseBytes: MAX_BYTES,
      networkRequests: requests.length,
      layers,
      requests,
      geometryGenerated: false,
      fullSFClaim: false,
      existingCapturesChanged: false,
    }
  await writeFile(
    resolve(staging, 'batch-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    { flag: 'wx' },
  )
  await rename(staging, destination)
  return {
    captureDirectory: destination,
    status: manifest.status,
    networkRequests: requests.length,
    dataPagesRequested,
    rowsThisBatch: Object.values(layers).reduce((s, l) => s + (l.rowsThisBatch ?? 0), 0),
    rawBytesThisBatch: Object.values(layers).reduce((s, l) => s + (l.rawBytesThisBatch ?? 0), 0),
    layers: Object.fromEntries(
      Object.entries(layers).map(([k, l]) => [
        k,
        {
          status: l.status,
          rowsThisBatch: l.rowsThisBatch,
          nextOffset: l.nextOffset,
          error: l.error,
        },
      ]),
    ),
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2),
    options = { fetchEnabled: args.includes('--fetch') }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--fetch') continue
    if (!['--output', '--resume', '--max-pages'].includes(args[i]) || !args[i + 1])
      throw new Error(
        'Usage: city-acquire.mjs [--fetch] [--resume prior-directory] [--max-pages 1..8] [--output directory]',
      )
    const key = { '--output': 'output', '--resume': 'resume', '--max-pages': 'maxPages' }[args[i]]
    options[key] = key === 'maxPages' ? Number(args[++i]) : args[++i]
  }
  const result = await captureBatch(options)
  console.log(JSON.stringify(result, null, 2))
  if (result.status === 'failed') process.exitCode = 1
}
