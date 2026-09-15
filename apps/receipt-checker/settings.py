"""Reading this service's own configuration.

**An empty environment variable means unset.** Compose writes `FOO: ${FOO:-}`
for anything optional, which sets `FOO` to the empty string rather than leaving
it out — and `os.environ.get("FOO", "60")` then returns `""`, not `"60"`, so
`int()` raises and the container dies on a variable the operator deliberately
left blank. Every read goes through here for that one reason.
"""

from __future__ import annotations

import os


def text(name: str, fallback: str = "") -> str:
    """A string setting, with a blank treated as absent."""
    return (os.environ.get(name) or "").strip() or fallback


def number(name: str, fallback: int) -> int:
    """A numeric setting. A blank or an unreadable value falls back."""
    try:
        return int(text(name, str(fallback)))
    except ValueError:
        return fallback


def flag(name: str) -> bool:
    """A boolean setting. Only `true` is true."""
    return text(name).lower() == "true"
