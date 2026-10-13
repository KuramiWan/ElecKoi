# The Error-Contract Gate Ledger and Its Expiry Conditions

[Back to the open-problems index](README.en.md) | [简体中文](error-contract-exemptions.md)

**Status: there is a ledger but no design — every exemption in it is a known point where a failure is
dropped, and each one names its expiry condition. The ledger only shrinks.**
(The **entry count and the ceiling are whatever the gate computes**: run `pnpm check:error-contract`; when
it passes, that one line *is* the source-file count, the hit count and `MAX_EXEMPTIONS`. This page treats no
number as a second source of truth, and every table below carries its snapshot date.)

`scripts/check-error-contract.mjs` (`pnpm check:error-contract`) asserts one set equality:
**the actual hit set == the ledger set**. The gate computes the hit set with its own three regular
expressions. The ledger lives in `scripts/error-contract-exemptions.json`, and its ceiling is the frozen
number `MAX_EXEMPTIONS` inside the gate. One extra hit, one missing hit, or one change to the ceiling
turns the gate red.

This page is where the **expiry condition of every exemption** is written down. Each exemption's
`tracking` field points at one of the families below. Once a family's condition holds, the matching
exemptions must be **deleted explicitly and `MAX_EXEMPTIONS` lowered together** — "only shrinks" means a
disappearing hit is never silently forgiven; it must leave behind a visible subtraction.

## Family A: existing code-drop throw sites

`new Error(<failure>.error.message)` takes only the message out of a failure and wraps it in a bare
`Error`, so the code and details disappear (rule 1 of decision 6 in ADR 0002). The rule's **receiver is a
wildcard** (it is not hard-coded to `result`), and a preceding `throw` is not required:
`finish(new Error(<…>.error.message))` compresses the code into a string just the same. **Four** sites are
therefore in the ledger:

| Site | Why it stays outside |
| --- | --- |
| `packages/dsh-product-api/src/client/index.ts:25` | The carrier is `status` (the Remote readiness handshake), not `result`; this one is a real envelope unwrap (`status` is an official `RemoteResult`) and belongs to a later, reducible batch |
| `packages/dsh-client-conversations/src/client.js:311` | The carrier is the stream snapshot's `promptError`, and the form is `finish(new Error(...))` (no `throw`) |
| `packages/dsh-client-conversations/src/client.js:333` | Same shape (`reason.error?.message` inside stream state) |
| `packages/dsh-client-roleplay/src/host/session-runtime.mjs:266` | The carrier is a DSH event payload, `event.data.reason.error`, not a product Remote envelope |

**Expiry condition:** these four sites keep the failure instance instead (`throw result.error`, or a
contract failure object), and the four exemptions are deleted with it. If the last two (stream-state
carriers) are judged not to deserve a contract code, they instead keep the whole failure object in the
snapshot and let the presentation layer resolve it.
(The first row is already judged to be a real code drop; this line of work simply did not fix it — see
[the error contract](../error-contract.md), "还差什么" item 10.)
(A fifth site, `packages/dsh-client-conversations/src/client.js:1769`, used the variable name `accepted`;
EH-4a's sixth commit turned it into one that keeps the failure instance, so that exemption was deleted from
the ledger and `MAX_EXEMPTIONS` was lowered with it.)

**Known blind spot:** `if (!x.ok) throw new Error('…')` (a throw that does not read `.error.message`) is
not covered by rule 1 — it is textually indistinguishable from an ordinary throw, and pairing it with the
guard would also catch `fetch`'s `if (!response.ok)`
(`apps/web/src/ui/ui/AvatarSlotsEditor.jsx:62` and `packages/dsh-product-api/src/tavily.ts:39` are HTTP
`Response.ok`, not a product RemoteResult). That blind spot is recorded in the gate's file header; this
page does not paper over it.

## Family B: fire-and-forget reads and refreshes on the package side (`packages/`)

`void this.refresh().catch(() => {})` after a connection reset, a stale snapshot, or a session switch:
the failure of that read is dropped and subscribers keep seeing the previous snapshot (rule 3 of
decision 6 in ADR 0002).

**Expiry condition:** the failure on this path gets an outlet (a failure field written into the snapshot,
the logger, or a renderer-side failure surface), and the matching exemptions are deleted file by file.
Decision 12 in ADR 0002 already gave the three **write queues** an outlet (EH-4a, commit `ab09210`); this
family is its sequel: the **read** path is still not connected.

## Family C: fire-and-forget calls in the renderer (`apps/web/`)

Window-local display calls, rejected callers of preference writes, the session list loaded at startup,
and chained continuations of the event queue: the failure is dropped.

**Expiry condition:** each site gets a failure surface in the interface (`role="alert"` or the failure
dialog), after which the exemption is deleted. Note that decision 12 in ADR 0002 explicitly does **not**
give the four secondary windows a toast surface (each already has an in-place failure surface), so the
expiry condition for the window-display group is not "add a notice" but "this call has a presentable
failure semantic".

## Family D: `catch` bodies that only contain a comment, or are empty

`try { … } catch { /* explanation */ }` and `} catch {}`: the catch body holds a comment, or nothing at
all. A comment is an explanation, not an exemption declaration — decision 6 asks for one entry in the
ledger.

**Expiry condition:** the catch body handles things explicitly (log it, fold it into a contract code, or
express "ignore" as a named decision), or its rationale is absorbed into the failure semantics of that
path. Adding a comment does not count.

## Why there are this many entries (the gate computes the authoritative values)

**The single source of truth for the numbers is the gate's live computation, not this page.** Two commands:

```bash
# The authoritative output line (one line when it passes): source files, hits, MAX_EXEMPTIONS
pnpm check:error-contract

# Ledger size and the per-rule / per-family distribution (the gate does not print it;
# import its checkErrorContract and summarize)
node -e "import('./scripts/check-error-contract.mjs').then(m=>{const r=m.checkErrorContract(process.cwd());const c={};for(const e of r.exemptions)c[e.tracking.split(' ').pop()]=(c[e.tracking.split(' ').pop()]??0)+1;console.log('hits/exemptions',r.hits.length,'/',r.exemptions.length,'ceiling',m.MAX_EXEMPTIONS,'families',c)})"
```

Below is a **snapshot taken on 2026-10-12 (after EH-11)**, for reading convenience only; when it does not
match, the commands win:

| Item | Snapshot value |
| --- | --- |
| Source files scanned (`apps/` + `packages/`, `.ts .tsx .js .jsx .mjs`, excluding `node_modules`/`dist`/`lib`/`out`) | 517 |
| Hits (three rules combined) | 65 |
| Of which "no code drop" (`no-code-drop`) | 4 |
| Of which "an empty catch needs an exemption" (`empty-catch`) | 61 |
| Of which "a contract violation needs the right code and complete issues" (`contract-invalid-details`) | 0 (it reports violations, not a count) |
| Per family: A / B / C / D | 4 / 41 / 14 / 6 |
| `MAX_EXEMPTIONS` (the frozen number inside the gate) | 65 |

Why the authoritative numbers are **not** hand-written: as soon as the gate's regular expressions or the
ledger move, copied numbers are wrong. This family has already been caught twice — the "43 sites / 40 in
`dsh-client-*`" figures in the spec and ADR could not be reproduced (ADR 0002, correction c), and the
`66 → 65` replay is recorded in correction p. The per-family counts follow the ledger; do not treat the
table above as a second source of truth.
