// Offline audit only. Raw captures and accepted scene/source assets are never modified.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { coveragePlan } from './plan.mjs'
import { normalizeLayer, intersects } from './acquire.mjs'
import { cleanRing, polygonArea, number } from '../data.mjs'

const directory = dirname(fileURLToPath(import.meta.url))
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const stable = (v) =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, stable(v[k])]),
        )
      : v
const prefix = {
  buildings: 'sf-building',
  roads: 'sf-road',
  trees: 'sf-tree',
  sidewalks: 'sf-sidewalk',
}
const geographicBounds = (positions) =>
  positions.reduce(
    (b, p) => [
      Math.min(b[0], p[0]),
      Math.min(b[1], p[1]),
      Math.max(b[2], p[0]),
      Math.max(b[3], p[1]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  )
const positions = (coordinates) =>
  typeof coordinates[0] === 'number' ? [coordinates] : coordinates.flatMap(positions)
const dateSummary = (values) => {
  const nonempty = values
    .filter((v) => v != null && String(v).trim() !== '')
    .map(String)
    .sort()
  return {
    missingRows: values.length - nonempty.length,
    minimum: nonempty[0] ?? null,
    maximum: nonempty.at(-1) ?? null,
    distinctValues: new Set(nonempty).size,
  }
}

export async function validateCapture(captureDirectory) {
  const plan = coveragePlan(),
    path = resolve(captureDirectory, 'batch-manifest.json')
  const bytes = await readFile(path),
    manifest = JSON.parse(bytes)
  if (!['partial', 'complete'].includes(manifest.status))
    throw new Error('Audit requires an accepted partial or complete source capture')
  const report = {
    version: 1,
    status: 'offline-source-validation',
    manifestPath: path,
    manifestSHA256: digest(bytes),
    sourceCaptureStatus: manifest.status,
    layers: {},
    completeGeographicCoverage: false,
    geometryGenerated: false,
    limitations: [
      'ID-ordered partial pages establish no complete geographic tiles, even where points are dense.',
      'Validation uses existing structural geometry checks, not a complete self-intersection or GIS topology certification.',
      'Planned envelopes are acquisition policy bounds, not authoritative SF land/jurisdiction masks.',
      'Small building footprints remain valid records but are filtered by the current generator threshold.',
      'All raw bytes remain preserved. Quarantine contains references and reasons, not deletion instructions.',
    ],
  }
  const verifiedFiles = new Map([[path, digest(bytes)]])
  for (const [layer, spec] of Object.entries(plan.acquisition.datasets)) {
    const records = [],
      groups = new Map(),
      rowIDs = new Set(),
      timestamps = [],
      updates = [],
      extents = []
    async function visit(folder, chainManifest, ancestry = new Set()) {
      if (ancestry.has(chainManifest.captureId)) throw new Error('Cyclic capture ancestry')
      const next = new Set(ancestry).add(chainManifest.captureId),
        state = chainManifest.layers[layer]
      if (!state || !['partial', 'complete'].includes(state.status))
        throw new Error('Invalid layer state')
      if (state.priorBatch) {
        const ancestorPath = state.priorBatch.manifestPath,
          raw = await readFile(ancestorPath)
        if (digest(raw) !== state.priorBatch.manifestSHA256)
          throw new Error('Ancestor manifest hash mismatch')
        verifiedFiles.set(ancestorPath, digest(raw))
        await visit(dirname(ancestorPath), JSON.parse(raw), next)
      }
      for (const page of state.pages) {
        const filename = resolve(folder, page.file),
          raw = await readFile(filename)
        if (digest(raw) !== page.sha256) throw new Error('Page hash mismatch: ' + page.file)
        verifiedFiles.set(filename, digest(raw))
        const rows = JSON.parse(raw)
        for (const [rowIndex, row] of rows.entries()) {
          const ref = {
            page: filename,
            rowIndex,
            systemRowID: row.capture_row_id,
            semanticID: null,
            reasons: [],
            warnings: [],
          }
          if (rowIDs.has(String(row.capture_row_id))) throw new Error('Duplicate transport row ID')
          rowIDs.add(String(row.capture_row_id))
          records.push(ref)
          timestamps.push(row.data_as_of)
          updates.push(row.capture_updated_at)
          try {
            const key = row[spec.key]
            if (
              !['string', 'number'].includes(typeof key) ||
              !String(key).trim() ||
              (typeof key === 'number' && !Number.isFinite(key))
            )
              throw new Error('Invalid semantic source ID')
            const id = `${prefix[layer]}:${layer === 'roads' ? Number(key) : key}`
            ref.semanticID = id
            const selected = Object.fromEntries(
              spec.fields.filter((k) => row[k] !== undefined).map((k) => [k, row[k]]),
            )
            ref.sourceRecordSHA256 = digest(JSON.stringify(stable(selected)))
            const group = groups.get(id) ?? []
            group.push(ref)
            groups.set(id, group)
            normalizeLayer(layer, [row], spec, [-180, -90, 180, 90], false)
            ref.structurallyValid = true
            const points =
              layer === 'trees'
                ? [[Number(row.longitude), Number(row.latitude)]]
                : positions(row[spec.geometry].coordinates)
            ref.bounds = geographicBounds(points)
            extents.push(...[ref.bounds.slice(0, 2), ref.bounds.slice(2)])
            const inEnvelope = plan.plannedCoverage.regions.some((region) =>
              layer === 'trees'
                ? points[0][0] >= region.bounds[0] &&
                  points[0][0] < region.bounds[2] &&
                  points[0][1] >= region.bounds[1] &&
                  points[0][1] < region.bounds[3]
                : intersects(row[spec.geometry], region.bounds),
            )
            if (!inEnvelope)
              ref.reasons.push('Outside all planned acquisition envelopes; requires spatial review')
            if (layer === 'buildings') {
              if (row.shape.type !== 'MultiPolygon')
                throw new Error('Current loadCity building adapter requires MultiPolygon')
              const polygons = row.shape.coordinates
                .map((p) => p.map(cleanRing))
                .filter((p) => p[0].length >= 3)
              const area = polygons.reduce((sum, p) => sum + polygonArea(p[0]), 0)
              if (!polygons.length || area < 20)
                ref.warnings.push(
                  'Valid source footprint filtered by current 20 square metre generator threshold',
                )
              if (!Number.isFinite(number(row.gnd_mediancm, NaN)))
                ref.warnings.push(
                  'No finite ground sample; requires interpolation from other buildings',
                )
              if (!Number.isFinite(number(row.hgt_median_m, NaN)))
                ref.warnings.push(
                  'Missing measured median height; generator uses inferred fallback',
                )
            }
          } catch (error) {
            ref.reasons.push(error.message)
          }
        }
      }
    }
    await visit(resolve(captureDirectory), manifest)
    if (records.length !== manifest.layers[layer].rowsTotal)
      throw new Error('Manifest total does not match audited pages')
    const duplicateGroups = []
    for (const [id, group] of groups)
      if (group.length > 1) {
        const conflict = new Set(group.map((r) => r.sourceRecordSHA256)).size > 1
        duplicateGroups.push({
          semanticID: id,
          rows: group.length,
          conflicting: conflict,
          references: group.map((r) => ({
            page: r.page,
            rowIndex: r.rowIndex,
            systemRowID: r.systemRowID,
            sourceRecordSHA256: r.sourceRecordSHA256,
          })),
        })
        if (conflict)
          for (const r of group)
            r.reasons.push(
              'Conflicting records share a semantic ID; explicit reconciliation required',
            )
        else for (const r of group.slice(1)) r.exactDuplicateCopy = true
      }
    const quarantine = records.filter((r) => r.reasons.length),
      valid = records.filter((r) => !r.reasons.length)
    const reasons = {},
      warnings = {}
    for (const r of records) {
      for (const reason of r.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1
      for (const warning of r.warnings) warnings[warning] = (warnings[warning] ?? 0) + 1
    }
    report.layers[layer] = {
      rawRows: records.length,
      structurallyValidRows: records.filter((r) => r.structurallyValid).length,
      usableRowsBeforeExactDeduplication: valid.length,
      usableUniqueSemanticIDs: new Set(valid.map((r) => r.semanticID)).size,
      quarantinedRows: quarantine.length,
      exactDuplicateCopies: records.filter((r) => r.exactDuplicateCopy).length,
      duplicateSemanticIDs: duplicateGroups.length,
      conflictingSemanticIDs: duplicateGroups.filter((g) => g.conflicting).length,
      observedValidGeometryBounds: extents.length ? geographicBounds(extents) : null,
      boundsMeaning: 'Extent of observed valid records, not complete covered area',
      sourceDataAsOf: dateSummary(timestamps),
      transportUpdatedAt: dateSummary(updates),
      reasons,
      warnings,
      duplicateGroups,
      quarantine,
      generatorFilteredSmallBuildingRows: records.filter((r) =>
        r.warnings.some((w) => w.includes('20 square metre')),
      ).length,
    }
  }
  for (const [filename, expected] of verifiedFiles)
    if (digest(await readFile(filename)) !== expected)
      throw new Error('Input changed during offline audit')
  report.totals = Object.values(report.layers).reduce(
    (sum, layer) => ({
      rawRows: sum.rawRows + layer.rawRows,
      usableUniqueSemanticIDs: sum.usableUniqueSemanticIDs + layer.usableUniqueSemanticIDs,
      quarantinedRows: sum.quarantinedRows + layer.quarantinedRows,
    }),
    { rawRows: 0, usableUniqueSemanticIDs: 0, quarantinedRows: 0 },
  )
  report.inputsVerifiedUnchanged = true
  return report
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !process.argv[3])
    throw new Error('Usage: validate-city-capture.mjs capture-directory report.json')
  const report = await validateCapture(process.argv[2]),
    output = resolve(process.argv[3])
  if (output.startsWith(resolve(process.argv[2]) + '/'))
    throw new Error('Write validation reports outside the immutable capture directory')
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output, ...report.totals, inputsVerifiedUnchanged: true }))
}
