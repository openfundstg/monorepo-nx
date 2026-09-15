# `receipt-checker` — the OCR engine

A small Python service the API talks to over the compose network. It keeps two
heavyweight things out of the API's image, and does one thing that cannot be
done from a server process at all.

## What it is for

| Endpoint | Answers |
|---|---|
| `POST /extract` (multipart `file`) | `{ text, source }` — everything readable in a receipt, from a PDF's text layer or by OCR |
| `GET /health` | whether the container is up. There is nothing left for it to be misconfigured about |

## Why a container

Reading text out of a PDF or a photograph needs an OCR engine and a PDF parser,
and neither belongs in the API's Node image — they are heavy, and they are the
two things in this stack that read bytes a stranger chose.

**It used to need a browser as well.** `check.gov.ua` would not answer a request
without a reCAPTCHA token minted by its own page, so this container drove that
page in a real Chrome. That verifier is gone: monobank's own certification
service proves a receipt by the qualified signature on it, which is a stronger
claim than a lookup and needs no token. Chrome, its driver, the fifteen X
libraries, the seccomp profile, the shared-memory tuning, the proxy pool and a
gigabyte of image went with it.

What remains makes **no outbound connection at all**, which is why its compose
network is now `internal`.

## Reading a stranger's file

Every byte that reaches `/extract` was uploaded by whoever is topping up, and
the libraries that make sense of one — a PDF parser, an image decoder — are
exactly the code that has a CVE every year. So the parsing does not happen in
the service process. `sandbox.py` spawns `extract_worker.py`, which sets its
ceilings *before* pypdf or Pillow is imported and answers on stdout:

| Ceiling | Value | Stops |
|---|---|---|
| `RLIMIT_AS` | 1 GB | decompression bombs, runaway allocation |
| `RLIMIT_CPU` | 30 s | a parser that will not terminate |
| `RLIMIT_FSIZE` | 64 MB | filling the container's disk |
| `RLIMIT_CORE` | 0 | a crash writing a decoded receipt to disk |
| wall clock (parent) | 45 s | anything blocked while burning no CPU |
| `Image.MAX_IMAGE_PIXELS` | 40 M | Pillow's own bomb guard, tightened from ~178 M |
| `MAX_PAGES` / `MAX_IMAGES` | 10 / 8 | a thousand-page "receipt" |

The child is handed one upload on stdin and a bare environment. A crash kills a
process
that owns nothing; the service answers "no text" and the receipt is refused for
a reason the user can act on.

Verified against a 1 GB zip-bomb PDF, a 74-byte PNG declaring a 60000×60000
canvas, and a self-referential page tree: empty text in ~150 ms each, container
alive, no restarts.

## Configuration

| Variable | Meaning |
|---|---|
| `RECEIPT_CHECKER_PORT` | Default `8100`. |
| `RECEIPT_CHECKER_EXTRACT_TIMEOUT_S` | Wall clock for one extraction. Default `45`. |
| `RECEIPT_CHECKER_MEMORY_BYTES` | The child's `RLIMIT_AS`. Default 1 GB. |
| `RECEIPT_CHECKER_CPU_SECONDS` | The child's `RLIMIT_CPU`. Default `30`. |
| `RECEIPT_CHECKER_LOG_LEVEL` | Default `INFO`. |

It is deliberately **not** given `apps/api/src/environments/.env`. That file
carries the database passwords, the Transacto session and the bot token, and
this is the container that parses files strangers upload — it gets the four
knobs above and nothing else. It used to need `PROXY_URLS` from the root `.env`
as well; with no outbound connection left, it does not.

## Things that will bite

- **It has no authentication and must never get a public port.** Compose
  publishes it on loopback and the API reaches it as `receipt-checker:8100`,
  exactly as Mongo and Redis are reached. Its network is `internal`, so it
  cannot reach out either — a parser bug is a dead end rather than a foothold
  with an exit.
- **Parsing runs in a child process under real limits**, never in the service:
  `RLIMIT_AS`, `RLIMIT_CPU` and a wall clock, so a PDF engineered to allocate
  forever is killed rather than tolerated. `init: true` reaps what that leaves.
- **Empty text is an answer, not an error.** A photograph too blurred to read is
  a fact about the file; what it means for the top-up behind it is the API's
  decision, not this container's.
- **Language data is installed into the image**, not fetched on first use. This
  container has no route to the internet, and an OCR engine that downloaded its
  own data would fail in a way that looks like an unreadable receipt.

## What it does not do

**It interprets nothing.** `check.gov.ua`'s body is passed back untouched. The
one place that understands their vocabulary — that amounts are kopecks, that a
*missing* `payments` key is how "no such receipt" is spelled — is
`apps/api/src/shared/interfaces/check-gov-ua.interface.ts`, beside the interface
describing it.

**It knows no receipt-code formats.** `/extract` returns text. Which parts of it
are a code, and whose, is a per-bank question answered by the strategies in
`apps/api/src/modules/receipt-verification/services/strategies/`.

**It does not log what it reads.** A monobank receipt states the recipient's
card unmasked; only lengths reach a log line.
