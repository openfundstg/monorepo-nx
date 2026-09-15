"""The child process that actually opens a stranger's file.

Run by `sandbox.py`, never imported. It reads one upload from stdin, prints
`{"text": ..., "source": ...}` on stdout, and dies rather than growing: the
limits below are set *before* the first byte is parsed, so a document that
decompresses to sixty gigabytes never gets the chance.

Nothing goes to stdout but the answer. A library that printed a warning there
would corrupt it, so every diagnostic goes to stderr — which the parent
deliberately does not record, because a parser's error message can quote the
document it choked on, and that document states two people's card numbers.
"""

from __future__ import annotations

import json
import resource
import sys

import settings


def _limit(name: int, value: int) -> None:
    """One ceiling, if this platform has it. Never fatal on its own."""
    try:
        _soft, hard = resource.getrlimit(name)
        ceiling = value if hard == resource.RLIM_INFINITY else min(value, hard)
        resource.setrlimit(name, (ceiling, hard))
    except (ValueError, OSError):
        print(f"could not set rlimit {name}", file=sys.stderr)


def apply_limits() -> None:
    """Applied before anything is parsed, and before pypdf or Pillow is imported."""
    # Address space. A receipt is ten megabytes at most and decoding one page of
    # it is tens of megabytes more; a gigabyte is far above any real document
    # and far below what a decompression bomb wants.
    _limit(resource.RLIMIT_AS, settings.number("RECEIPT_CHECKER_MEMORY_BYTES", 1 << 30))
    # CPU seconds. Stops a parser that will not terminate — a cross-reference
    # table pointing at itself is the classic one — without waiting out the
    # parent's wall clock.
    _limit(resource.RLIMIT_CPU, settings.number("RECEIPT_CHECKER_CPU_SECONDS", 30))
    # File size. Not zero: pytesseract writes the image to a temp file and runs
    # the `tesseract` binary over it, so writing has to work — it simply must
    # not be able to fill the container's disk.
    _limit(resource.RLIMIT_FSIZE, 64 << 20)
    # Core dumps. A crash here would otherwise write a stranger's receipt,
    # decoded, to the filesystem.
    _limit(resource.RLIMIT_CORE, 0)


def main() -> None:
    apply_limits()

    data = sys.stdin.buffer.read()

    # Imported after the limits are in place: an allocation made while a module
    # loads is covered too.
    import extract

    text, source = extract.extract(data)

    json.dump({"text": text, "source": source}, sys.stdout)


if __name__ == "__main__":
    main()
