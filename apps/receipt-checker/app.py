"""The receipt checker's HTTP face.

Two endpoints, no state, no database, and — since the browser left — **no
outbound network at all**. It exists for one job that cannot be done in the
API's Node image without dragging an OCR engine into it: reading text out of a
PDF or a photograph, in a process that can be killed when a file a stranger
uploaded turns out to be hostile.

It used to do a second job, driving `check.gov.ua` in a real Chrome for a
reCAPTCHA token. That service is gone from this product — monobank's own
certification service proves a receipt by its signature and needs no token — and
the browser, the proxy pool and the seccomp profile went with it.

**It is not exposed off the host.** Compose publishes it on loopback and the API
reaches it as `receipt-checker:8100` over the compose network, the way Mongo and
Redis are reached. There is no authentication for the same reason those have
none inside the network — and for that reason it must never be given a public
port. Its segment is now `internal`, so nothing it parses can reach out either.
"""

from __future__ import annotations

import logging
import os

from flask import Flask, jsonify, request
from waitress import serve

import sandbox
import settings

logging.basicConfig(
    level=settings.text("RECEIPT_CHECKER_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

LOGGER = logging.getLogger("receipt-checker")

app = Flask(__name__)

# Matches FIAT_RECEIPT_MAX_BYTES in @transacto/contracts. The API refuses a
# larger file before it gets here; this is the same limit held for a caller that
# did not come through it.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES

@app.get("/health")
def health() -> tuple:
    """Whether this container is running.

    There is nothing left for it to be misconfigured about. It used to report
    the proxy pool, masked, because "is the proxy configured correctly" had cost
    more than one debugging round trip — and that pool existed only for the
    browser, which no longer exists either. This container now reaches nothing.
    """
    return jsonify({"ok": True}), 200


@app.post("/extract")
def extract_text() -> tuple:
    """Whatever text an uploaded receipt carries.

    Empty text is an ordinary answer with a 200, not an error: a photograph too
    blurred to recognise is a fact about the file, and the caller decides what it
    means for the top-up behind it.
    """
    uploaded = request.files.get("file")
    if uploaded is None:
        return jsonify({"error": "no file"}), 400

    data = uploaded.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        return jsonify({"error": "too large"}), 413

    # Through the sandbox, never straight at the parser: these bytes came from
    # whoever is topping up, and a PDF parser handed a whole service is how one
    # upload takes the receipt path down for everybody. See `sandbox.py`.
    text, source = sandbox.extract(data, uploaded.filename or "")

    # The sandbox reports what it read; this line reports that a request
    # happened at all, so an empty answer is distinguishable from no request.
    # Neither prints the text: it states two people's card numbers, a monobank
    # receipt carrying the recipient's unmasked. The filename is a stranger's
    # string and is not interpolated either.
    if not text:
        LOGGER.warning("Nothing could be read from a %d byte upload", len(data))

    return jsonify({"text": text, "source": source}), 200




def main() -> None:
    port = settings.number("RECEIPT_CHECKER_PORT", 8100)

    # A handful of threads. Each extraction already runs in a child process
    # under its own limits, so the interpreter is not the scarce resource; what
    # this buys is that a slow parse cannot make `/health` look dead.
    LOGGER.info("Receipt checker listening on %d", port)
    serve(app, host="0.0.0.0", port=port, threads=4)


if __name__ == "__main__":
    main()
