# Test rules

Three rules from bugs that passed review with green tests. They apply to every PR.

1. **Leave while it runs.** Anything that can outlive the tab that started it (a run,
   a connection, an import, a request) gets a test that leaves the tab and comes back
   while the work is still going. Coming back to an idle tab proves nothing: that is
   how a blank Runner survived several fixes (issue #317).
2. **Use the real output at a seam.** A test of a feature that reads another feature's
   output starts from that feature's real output, not a tidy value typed by hand. Mock
   endpoints were tested with `/orders` while imports stored full URLs (issue #318).
3. **Try the bad file.** Code that takes a user's file is tested with a broken, empty,
   wrong-format and oversized file, and with content that points elsewhere, such as an
   external `$ref` (issue #319).

The per-PR e2e run covers `tests/e2e/ui/[0-9]*` and `inventory`. `flows/` and `tur1/` run
only at night; a failed night opens or updates the "Nightly E2E is failing" issue.

## Before each RC: the seeded-fault drill

Not per PR. The three rules above are about how tests are written; this checks that the
suite still notices bugs. `scripts/e2e-fault-drill.mjs` plants one known bug at a time
(`tests/e2e/drill/faults.json`) in `src/`, builds, runs the specs meant to cover that
journey and records whether any went red.

```bash
node scripts/e2e-fault-drill.mjs --check     # read-only: is every fault still plantable?
node scripts/e2e-fault-drill.mjs             # the drill; --only F01,F08 for a few, --report <path>
```

- **The checkout to yourself.** It edits `src/`, rebuilds `out/` and flips the native ABI.
  No unit run, build or other Playwright run meanwhile; `src/` must be clean to start.
- **Time.** Two builds per fault (a clean baseline, then the fault) plus the fault's specs
  twice. Measured: about 100 s per fault with `--no-unit` (3 faults: 105, 113 and 89 s), so the 31 faults take about an
  hour; a missed fault adds a `vitest related` run. Run it while doing something else.
- **Three numbers**, never added together:
  1. `E2E SCORE` — faults that made an e2e test fail. The only e2e score.
  2. `caught by unit only` — e2e missed it, `vitest related` went red. A second column.
  3. `caught nowhere` — neither noticed it.
  Everything else (`crash`, `build-failed`, `timeout`, `no-baseline`, `no-result`) was
  not measured.
- **A fault caught nowhere gets a test first**, in the spec that should have seen it, then
  the drill is run for that fault again. Read why the existing specs stayed green before
  writing it: so far it was a path the specs never took (a different row type, a pre-check
  that stops the file first, a failing assertion where a passing one was needed).
- **A stale `--check`** (find text gone, spec moved) means fixing `faults.json`, not
  skipping the fault.
- **"Caught" must fit the fault's `expectedFailure`.** A spec that goes red somewhere else
  (a timeout, a setup step) is not a catch; read the failing line.
- **A fault can be equivalent.** If a second guard makes the same decision, the planted
  change cannot be seen by any test, and "missed" is correct. Plant a `throw` in the same
  place to tell: if no spec goes red the line is not on those specs' path (fix `specs` or
  the journey), if one does the line is on the path and the original change is
  equivalent or the assertion is missing.
