"""Reading a stranger's file without letting it read us.

**Every byte handled here arrived from the internet.** A receipt is uploaded by
whoever is topping up, and the two libraries that make sense of one — a PDF
parser and an image decoder — are exactly the kind of code that has a CVE every
year: malloc bombs, quadratic parses, decompression bombs, infinite loops on a
cross-reference table that points at itself. Handing that a whole service is how
one upload takes the receipt path down for everybody.

So the parsing does not happen in this process. It happens in a fresh
interpreter with a hard memory ceiling, a hard CPU ceiling and a wall-clock
deadline, holding nothing but the bytes and answering on stdout. Three
consequences, and all three are the point:

* **A crash is contained.** A segfault in an image decoder kills a child that
  owns nothing. The service answers "no text" and the receipt is refused for a
  reason the user can act on.
* **A bomb is bounded.** A page that decompresses to sixty gigabytes hits
  `RLIMIT_AS` and dies; a parser that will not terminate hits `RLIMIT_CPU` and
  then the deadline.
* **There is nothing to steal.** The child is handed one upload on stdin. It
  never sees the environment this service was started with — no proxy
  credentials, no URLs, nothing that would be worth an exploit.

What this does **not** claim: the child still shares the container's network
namespace, so a full remote-code-execution in pypdf would reach whatever this
container can reach. That is bounded at the other end instead — the container
runs unprivileged, drops every capability, and is on a network that cannot see
Mongo or Redis. See `docker-compose.yml`.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import time

import settings

LOGGER = logging.getLogger(__name__)

WORKER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "extract_worker.py")

PDF_TEXT = "PDF_TEXT"
OCR = "OCR"


def _deadline_s() -> int:
    """Wall clock for one extraction, over and above the CPU ceiling.

    Both are needed and they catch different failures: `RLIMIT_CPU` stops a
    parser spinning, and this stops one blocked on something that burns no CPU
    at all.
    """
    return settings.number("RECEIPT_CHECKER_EXTRACT_TIMEOUT_S", 45)


def extract(data: bytes, filename: str) -> tuple[str, str]:
    """The text in a receipt, and which source it came from.

    Never raises. Every failure — a crash, a timeout, a limit, a file that is
    not a document at all — is empty text, because all of them mean the same
    thing to the caller: nothing could be read out of this upload.
    """
    started = time.monotonic()

    try:
        finished = subprocess.run(
            [sys.executable, WORKER],
            input=data,
            capture_output=True,
            timeout=_deadline_s(),
            # A bare environment. The child needs an interpreter and a
            # `tesseract` on PATH, and has no business seeing the proxy pool.
            env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": "/tmp"},
            check=False,
        )
    except subprocess.TimeoutExpired:
        LOGGER.warning("Extraction of %d bytes hit the %ds deadline", len(data), _deadline_s())
        return "", OCR

    if finished.returncode != 0:
        # Includes the signals: -9 is the memory ceiling, -24 the CPU one. The
        # child's stderr is not logged — it can quote the document.
        LOGGER.warning(
            "Extraction of %d bytes exited %d without an answer", len(data), finished.returncode
        )
        return "", OCR

    try:
        answer = json.loads(finished.stdout)
        text, source = str(answer["text"]), str(answer["source"])

        # Lengths only. A receipt states two people's accounts, and a monobank
        # one states the recipient's card unmasked.
        LOGGER.info(
            "Read %d characters from %d bytes by %s in %.1fs",
            len(text), len(data), source, time.monotonic() - started,
        )

        return text, source
    except (ValueError, KeyError, TypeError):
        LOGGER.error("The extraction worker answered something unreadable")

        return "", OCR
