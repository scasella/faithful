# Security policy

## Reporting a vulnerability

Please report a vulnerability privately, not in a public issue. Use GitHub's private vulnerability reporting: open the
repository's "Security" tab, then "Report a vulnerability".

Include the version or commit, what you did, what you expected and what happened. Faithful runs on your machine, so
reports are about that code: the local server, the file writes, the way model output is checked, and the sandbox
described below.

## What the threat model is

The full model, with the probes that were run and the known gaps, is [docs/SECURITY.md](docs/SECURITY.md). In short:

* The server listens on `127.0.0.1` only. Every request must carry a `Host` of `127.0.0.1`, `localhost` or `[::1]` with
  the right port (DNS rebinding), and an `Origin` or `Sec-Fetch-Site` that is the same origin (a web page you visit
  cannot drive it).
* Every `/api/` route needs a per-process random token. The token protects against browsers, not against other processes
  on your machine that can reach 127.0.0.1; those are trusted.
* The code Faithful runs (your function, instrumented copies, mutants and model-written candidates) runs in a Node worker
  thread with realm hardening, a purity mask, a heap limit and a wall-clock watchdog. This catches accidents. It is not a
  security boundary: the worker shares your process, file system and network. Do not point Faithful at code you do not
  trust.
* Codex is called as one `codex exec` subprocess per request, with `--sandbox read-only`, in a freshly created empty
  temporary directory; the repository is never given to it. The read-only sandbox is enforced by Codex, not by Faithful.
* Nothing leaves your machine except the prompts to Codex, shown verbatim in the UI under "What the model saw".
  `faithful setup --yes` downloads the Lean toolchain and the Mathlib cache once.
* Faithful never modifies your source files. It writes only under `<repo>/.faithful/<fn>/`, and proof text from the model
  is vetted and then checked by Lean itself before anything is accepted.

Known gaps are listed in docs/SECURITY.md, "Known gaps".
