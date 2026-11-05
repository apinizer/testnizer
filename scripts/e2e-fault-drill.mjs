#!/usr/bin/env node
// Seeded-fault drill: plant one known bug at a time in src/, build, run the
// specs meant to cover that journey and record whether any went red, so every
// fault the e2e suite misses becomes a test. Run by hand before an RC; never
// per PR (hours of builds + Playwright).
//
// Usage:
//   node scripts/e2e-fault-drill.mjs --check                 read-only staleness check
//   node scripts/e2e-fault-drill.mjs [--only F01,F02] [--report <path>]
//                                    [--timeout-min 25] [--baseline-timeout-min 120]
//
// Needs the checkout to itself: it edits src/, rebuilds out/ and runs the ui
// project. Do not run unit tests, builds or other Playwright runs meanwhile.
// Faults live in tests/e2e/drill/faults.json. Default report:
// node_modules/.cache/testnizer-fault-drill/ (gitignored, and not test-results/,
// which Playwright wipes at the start of every run).
//
// Exit: 0 run completed (the score is output, not a gate); 1 --check found a
// stale fault or a refusal to start; 2 usage; 3 tool problem; 4 restore failed
// or src/ is not clean at the end.
//
// Classes: caught | missed | crash | build-failed | timeout, plus two that are
// neither a catch nor a miss: no-baseline (none of the fault's specs passed
// clean, so nothing could be caught) and no-result (the specs reported nothing).
// Launch-type errors are matched by text; Playwright also prints "Target ...
// closed" when a context is torn down at a timeout, so `crash` needs EVERY
// baseline-passing test to have failed that way.

import { spawn, spawnSync, execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FAULTS_PATH = path.join(ROOT, 'tests/e2e/drill/faults.json')
const WORK_DIR = path.join(ROOT, 'node_modules/.cache/testnizer-fault-drill')

// ─── Pure logic (unit-tested in tests/main/fault-drill.test.ts) ──────────────

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

export function countOccurrences(source, needle) {
  if (!needle) return 0
  return source.split(needle).length - 1
}

/** Returns `source` with `fault.find` replaced once. Slicing, not String.replace: `$&` in replace text must stay literal. */
export function applyFault(source, fault) {
  const n = countOccurrences(source, fault.find)
  if (n !== 1) {
    throw new Error(`${fault.id}: "find" occurs ${n} times in ${fault.file}, expected exactly 1`)
  }
  if (fault.find === fault.replace) throw new Error(`${fault.id}: "replace" equals "find"`)
  const at = source.indexOf(fault.find)
  return source.slice(0, at) + fault.replace + source.slice(at + fault.find.length)
}

/** A spec entry is written either repo-relative or relative to tests/e2e/ui/. */
export function resolveSpec(spec, exists) {
  const clean = spec.replace(/^\.\//, '')
  return [clean, `tests/e2e/ui/${clean}`].find((c) => exists(c)) ?? null
}

/** Playwright reports files relative to its rootDir (tests/e2e), so match by path suffix. */
export function fileMatchesSpec(file, spec) {
  return spec === file || spec.endsWith(`/${file}`)
}

export function validateFaults(list) {
  if (!Array.isArray(list) || list.length === 0) throw new Error('faults.json must be a non-empty array')
  const seen = new Set()
  for (const f of list) {
    for (const k of ['id', 'file', 'find']) {
      if (typeof f?.[k] !== 'string' || !f[k]) throw new Error(`fault ${f?.id ?? '?'}: "${k}" must be a non-empty string`)
    }
    // "replace" may be empty: a fault that deletes the matched text (F36).
    if (typeof f.replace !== 'string') throw new Error(`fault ${f.id}: "replace" must be a string`)
    if (!Array.isArray(f.specs) || f.specs.length === 0) throw new Error(`fault ${f.id}: "specs" must be a non-empty array`)
    if (seen.has(f.id)) throw new Error(`duplicate fault id ${f.id}`)
    seen.add(f.id)
  }
  return list
}

const ANSI = /\u001b\[[0-9;]*m/g
export const firstLine = (text) =>
  String(text ?? '').replace(ANSI, '').split('\n').map((l) => l.trim()).find(Boolean) ?? ''

const LAUNCH_ERROR =
  /firstWindow|Target (page, context or browser )?(has been )?closed|assertElectronNativeAbi|better-sqlite3 is built for|electron\.launch|Process failed to launch|ERR_DLOPEN_FAILED|NODE_MODULE_VERSION|Test servers (exited|did not start)/i
export const isLaunchError = (text) => LAUNCH_ERROR.test(String(text ?? '').replace(ANSI, ''))

/** Flattens Playwright's JSON report into `{tests, errors}`; status is passed | failed | skipped. */
export function parseReport(report) {
  const tests = []
  const walk = (suite, titles) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const last = (t.results ?? []).at(-1)
        const outcome = t.status ?? (last?.status === 'passed' ? 'expected' : last ? 'unexpected' : 'skipped')
        const status = outcome === 'expected' || outcome === 'flaky' ? 'passed' : outcome === 'skipped' ? 'skipped' : 'failed'
        const err = last?.errors?.[0]?.message ?? last?.error?.message ?? ''
        tests.push({
          key: [`${spec.file ?? suite.file}${spec.line ? `:${spec.line}` : ''}`, ...titles, spec.title].join(' › '), // line keeps duplicate titles apart
          file: spec.file ?? suite.file,
          status,
          error: status === 'failed' ? String(err).replace(ANSI, '').slice(0, 2000) : '',
        })
      }
    }
    for (const s of suite.suites ?? []) walk(s, [...titles, s.title])
  }
  for (const top of report?.suites ?? []) walk(top, []) // top-level suite title is the file
  const errors = (report?.errors ?? []).map((e) => String(e.message ?? e).replace(ANSI, '').slice(0, 2000))
  return { tests, errors }
}

/**
 * baseline / result: `{tests, errors}` from parseReport (result may be null).
 * Only tests that passed in baseline can count, so an already-red test is never a catch.
 */
export function classifyFault({ specs, baseline, result, buildFailed = false, timedOut = false }) {
  const out = (status, extra = {}) => ({ status, caught: [], baselinePassed: 0, ...extra })
  if (buildFailed) return out('build-failed')
  if (timedOut) return out('timeout')
  const inSpecs = (t) => specs.some((s) => fileMatchesSpec(t.file, s))
  const passedBefore = (baseline?.tests ?? []).filter((t) => t.status === 'passed' && inSpecs(t))
  if (passedBefore.length === 0) return out('no-baseline')
  const now = new Map((result?.tests ?? []).map((t) => [t.key, t]))
  const ran = passedBefore
    .map((t) => now.get(t.key))
    .filter((t) => t && (t.status === 'passed' || t.status === 'failed'))
  const base = { baselinePassed: passedBefore.length }
  if (ran.length === 0) {
    return out((result?.errors ?? []).some(isLaunchError) ? 'crash' : 'no-result', base)
  }
  const failed = ran.filter((t) => t.status === 'failed')
  if (failed.length === 0) return out('missed', base)
  if (failed.length === ran.length && failed.every((t) => isLaunchError(t.error))) return out('crash', base)
  return out('caught', { ...base, caught: failed.map((t) => ({ test: t.key, error: firstLine(t.error) })) })
}

export const STATUSES = ['caught', 'missed', 'crash', 'build-failed', 'timeout', 'no-baseline', 'no-result']

export function countStatuses(records) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]))
  for (const r of records) counts[r.status] = (counts[r.status] ?? 0) + 1
  return counts
}

export function parseArgs(argv) {
  const opts = { check: false, only: null, report: null, timeoutMin: 25, baselineTimeoutMin: 120 }
  const need = (i) => {
    if (argv[i + 1] === undefined) throw new Error(`${argv[i]} needs a value`)
    return argv[i + 1]
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--check') opts.check = true
    else if (a === '--only') opts.only = need(i++).split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--report') opts.report = need(i++)
    else if (a === '--timeout-min') opts.timeoutMin = Number(need(i++))
    else if (a === '--baseline-timeout-min') opts.baselineTimeoutMin = Number(need(i++))
    else throw new Error(`unknown argument ${a}`)
  }
  if (!(opts.timeoutMin > 0) || !(opts.baselineTimeoutMin > 0)) throw new Error('timeouts must be positive numbers of minutes')
  return opts
}

// ─── Runner (not unit-tested; touches src/, git, npm and Playwright) ─────────

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
const srcDirty = () => git('status', '--porcelain', '--', 'src').trim()
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

function inspectFault(f) {
  const abs = path.join(ROOT, f.file)
  const problems = []
  let occurrences = null
  if (!fs.existsSync(abs)) problems.push(`file missing: ${f.file}`)
  else {
    occurrences = countOccurrences(fs.readFileSync(abs, 'utf8'), f.find)
    if (occurrences !== 1) problems.push(`"find" occurs ${occurrences}x (need 1)`)
    if (f.find === f.replace) problems.push('"replace" equals "find"')
  }
  const resolved = f.specs.map((s) => resolveSpec(s, exists))
  f.specs.forEach((s, i) => resolved[i] || problems.push(`spec missing: ${s}`))
  return { id: f.id, specs: resolved.filter(Boolean), problems, occurrences }
}

let current = null // running child process
let active = null // { abs, original, hash } while a fault is on disk
const state = { report: null, reportPath: null, outDirty: false }

function writeReport() {
  if (!state.report) return
  state.report.updatedAt = new Date().toISOString()
  state.report.counts = countStatuses(state.report.faults)
  fs.mkdirSync(path.dirname(state.reportPath), { recursive: true })
  fs.writeFileSync(`${state.reportPath}.tmp`, JSON.stringify(state.report, null, 2))
  fs.renameSync(`${state.reportPath}.tmp`, state.reportPath)
}

/** Mirrors tests/e2e/global-teardown.ts: a killed Playwright run never reaches its teardown. */
function reapTestServers() {
  const dir = path.join(ROOT, 'tests/e2e/servers')
  try { process.kill(Number(fs.readFileSync(path.join(dir, '.supervisor.pid'), 'utf8').trim()), 'SIGTERM') } catch { /* not running */ }
  for (const f of ['.supervisor.pid', '.test-servers.json']) fs.rmSync(path.join(dir, f), { force: true })
}

function killGroup(child) {
  if (!child?.pid) return
  try { process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ }
  setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch { /* gone */ } }, 10_000).unref()
}

function runStep(label, cmd, args, { timeoutMs, env = {} }) {
  const logPath = path.join(WORK_DIR, `${label}.log`)
  const fd = fs.openSync(logPath, 'w')
  return new Promise((resolve) => {
    let timedOut = false
    let done = false
    const child = spawn(cmd, args, {
      cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd], detached: true,
    })
    current = child
    const finish = (code, signal) => {
      if (done) return
      done = true
      clearTimeout(timer)
      current = null
      fs.closeSync(fd)
      const log = fs.readFileSync(logPath, 'utf8')
      resolve({ code, signal, timedOut, logPath, tail: log.slice(-3000) })
    }
    const timer = setTimeout(() => { timedOut = true; killGroup(child) }, timeoutMs)
    child.on('error', () => finish(-1, null))
    child.on('close', finish)
  })
}

const build = (label, timeoutMs = 15 * 60_000) => runStep(label, 'npm', ['run', 'build'], { timeoutMs })

async function playwright(label, specs, timeoutMs) {
  const jsonPath = path.join(WORK_DIR, `${label}.json`)
  fs.rmSync(jsonPath, { force: true })
  const filters = specs.map((s) => `${escapeRegex(path.join(ROOT, s))}$`)
  const r = await runStep(label, 'npx', [
    'playwright', 'test', '--project=ui', '--retries=0', '--reporter=json',
    '--output', path.join(WORK_DIR, 'pw-output'), ...filters,
  ], { timeoutMs, env: { PLAYWRIGHT_JSON_OUTPUT_FILE: jsonPath } })
  let parsed = null
  try { parsed = parseReport(JSON.parse(fs.readFileSync(jsonPath, 'utf8'))) } catch { /* no usable report */ }
  return { ...r, parsed }
}

function plant(fault) {
  const abs = path.join(ROOT, fault.file)
  const original = fs.readFileSync(abs)
  const source = original.toString('utf8')
  if (!Buffer.from(source, 'utf8').equals(original)) throw new Error(`${fault.file} is not valid UTF-8`)
  const next = applyFault(source, fault)
  active = { abs, original, hash: sha256(original) }
  fs.writeFileSync(abs, next)
}

function restore() {
  if (!active) return
  const { abs, original, hash } = active
  fs.writeFileSync(abs, original)
  const now = sha256(fs.readFileSync(abs))
  if (now !== hash) throw new Error(`RESTORE FAILED for ${abs}: hash ${now} != ${hash}`)
  active = null
}

function onSignal(sig) {
  console.error(`\n[drill] ${sig}: stopping, restoring src/`)
  if (current?.pid) { try { process.kill(-current.pid, 'SIGKILL') } catch { /* gone */ } }
  reapTestServers()
  try { restore() } catch (e) { console.error(`[drill] ${e.message}`); process.exit(4) }
  if (state.report) { state.report.interrupted = true; writeReport() }
  if (state.outDirty) console.error('[drill] out/ may still hold a fault build: run `npm run build` before using it.')
  process.exit(130)
}
process.on('SIGINT', () => onSignal('SIGINT'))
process.on('SIGTERM', () => onSignal('SIGTERM'))
process.on('exit', () => { try { restore() } catch (e) { console.error(`[drill] ${e.message}`) } })

function tally(baseline) {
  const by = (s) => baseline.tests.filter((t) => t.status === s).map((t) => t.key)
  return { passed: by('passed'), failed: by('failed'), skipped: by('skipped'), errors: baseline.errors }
}

function printTable(counts, records) {
  console.log('\n=== fault drill ===')
  for (const s of STATUSES) if (counts[s]) console.log(`${s.padEnd(13)} ${counts[s]}`)
  console.log(`${'total'.padEnd(13)} ${records.length}`)
  for (const r of records.filter((x) => x.status === 'missed')) {
    console.log(`MISSED ${r.id} [${r.journey}] ${r.expectedFailure}`)
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  let faults = validateFaults(JSON.parse(fs.readFileSync(FAULTS_PATH, 'utf8')))
  if (opts.only) {
    const unknown = opts.only.filter((id) => !faults.some((f) => f.id === id))
    if (unknown.length) throw new Error(`unknown fault id(s): ${unknown.join(', ')}`)
    faults = faults.filter((f) => opts.only.includes(f.id))
  }
  const inspections = new Map(faults.map((f) => [f.id, inspectFault(f)]))
  const stale = [...inspections.values()].filter((i) => i.problems.length)

  if (opts.check) {
    for (const f of faults) {
      const i = inspections.get(f.id)
      console.log(`${i.problems.length ? 'STALE' : 'ok   '} ${f.id} find x${i.occurrences ?? '?'} specs ${i.specs.length}/${f.specs.length} ${f.file}${i.problems.length ? '  -> ' + i.problems.join('; ') : ''}`)
    }
    const dirty = srcDirty()
    if (dirty) console.log(`note: src/ has uncommitted changes, the drill would refuse to start:\n${dirty}`)
    console.log(`${faults.length - stale.length}/${faults.length} faults current`)
    return stale.length ? 1 : 0
  }

  if (stale.length) {
    for (const i of stale) console.error(`stale ${i.id}: ${i.problems.join('; ')}`)
    console.error('[drill] refusing to start: fix faults.json (see --check)')
    return 1
  }
  const dirty = srcDirty()
  if (dirty) {
    console.error(`[drill] refusing to start: src/ is not clean:\n${dirty}`)
    return 1
  }

  fs.mkdirSync(WORK_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  state.reportPath = path.resolve(opts.report ?? path.join(WORK_DIR, `report-${stamp}.json`))
  state.report = {
    startedAt: new Date().toISOString(), head: git('rev-parse', '--short', 'HEAD').trim(),
    selected: faults.map((f) => f.id), baseline: null, faults: [], interrupted: false, complete: false,
  }
  console.log(`[drill] ${faults.length} fault(s); logs in ${WORK_DIR}; report ${state.reportPath}`)

  const abi = spawnSync(process.execPath, [path.join(ROOT, 'scripts/ensure-native-abi.js'), 'electron'], { cwd: ROOT, stdio: 'inherit' })
  if (abi.status !== 0) { console.error('[drill] ensure-native-abi electron failed'); return 3 }

  // Baseline: one clean build, the union of all selected specs, once.
  const allSpecs = [...new Set(faults.flatMap((f) => inspections.get(f.id).specs))]
  console.log(`[drill] baseline: build + ${allSpecs.length} spec file(s)`)
  const b = await build('baseline-build')
  if (b.code !== 0) { console.error(`[drill] baseline build failed:\n${b.tail}`); return 3 }
  const base = await playwright('baseline-run', allSpecs, opts.baselineTimeoutMin * 60_000)
  if (!base.parsed || base.timedOut) { console.error(`[drill] baseline run unusable (timedOut=${base.timedOut}):\n${base.tail}`); return 3 }
  const baseline = base.parsed
  state.report.baseline = tally(baseline)
  writeReport()
  console.log(`[drill] baseline: ${state.report.baseline.passed.length} passed, ${state.report.baseline.failed.length} red, ${state.report.baseline.skipped.length} skipped`)
  if (state.report.baseline.passed.length === 0) { console.error('[drill] no test passed in baseline, nothing to measure'); return 3 }

  for (const f of faults) {
    const t0 = Date.now()
    const deadline = t0 + opts.timeoutMin * 60_000 // one budget per fault: build + run
    let verdict
    let log = null
    try {
      plant(f)
      state.outDirty = true
      const bf = await build(`${f.id}-build`, Math.min(15 * 60_000, deadline - Date.now()))
      if (bf.timedOut) {
        log = bf.logPath
        verdict = classifyFault({ specs: inspections.get(f.id).specs, baseline, timedOut: true })
        verdict.detail = 'build ran out of the per-fault time limit'
      } else if (bf.code !== 0) {
        log = bf.logPath
        verdict = classifyFault({ specs: inspections.get(f.id).specs, baseline, buildFailed: true })
        verdict.detail = firstLine(bf.tail.split('\n').filter((l) => /error/i.test(l)).at(0) ?? bf.tail)
      } else {
        const r = await playwright(`${f.id}-run`, inspections.get(f.id).specs, Math.max(60_000, deadline - Date.now()))
        log = r.logPath
        if (r.timedOut) reapTestServers()
        verdict = classifyFault({ specs: inspections.get(f.id).specs, baseline, result: r.parsed ?? { tests: [], errors: [r.tail] }, timedOut: r.timedOut })
        if (!r.parsed) verdict.detail = 'no JSON report written'
      }
    } finally {
      restore() // throws on hash mismatch: a failed restore ends the run (exit 4)
    }
    const record = { id: f.id, journey: f.journey, origin: f.origin, file: f.file, specs: inspections.get(f.id).specs, expectedFailure: f.expectedFailure, ...verdict, seconds: Math.round((Date.now() - t0) / 1000), log }
    state.report.faults.push(record)
    writeReport()
    const first = record.caught[0]
    console.log(`[drill] ${f.id} ${record.status.toUpperCase()} (${record.seconds}s) ${f.journey}${first ? ` | ${record.caught.length} red, e.g. ${first.test}: ${first.error}` : ''}${record.detail ? ` | ${record.detail}` : ''}`)
  }

  console.log('[drill] final clean rebuild')
  const fin = await build('final-build')
  if (fin.code !== 0) { console.error(`[drill] final rebuild failed, out/ may hold a fault:\n${fin.tail}`); return 4 }
  state.outDirty = false
  const left = srcDirty()
  if (left) { console.error(`[drill] FAILED: src/ is not clean after the run:\n${left}`); return 4 }

  state.report.complete = true
  writeReport()
  printTable(state.report.counts, state.report.faults)
  console.log(`report: ${state.reportPath}`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`[drill] ${e.message}`)
      if (state.outDirty) console.error('[drill] out/ may hold a fault build: run `npm run build`.')
      try { restore() } catch (r) { console.error(`[drill] ${r.message}`); process.exit(4) }
      process.exit(/^(unknown argument|unknown fault id|.* needs a value|timeouts must)/.test(e.message) ? 2 : 3)
    },
  )
}
