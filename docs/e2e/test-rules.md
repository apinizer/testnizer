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
