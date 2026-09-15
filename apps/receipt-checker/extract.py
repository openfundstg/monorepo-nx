"""Reading whatever text a receipt file carries.

**Runs inside `extract_worker.py`, never in the service process**, under a
memory ceiling, a CPU ceiling and a deadline. Everything below assumes the file
is hostile until proven otherwise, because every byte of it came from whoever is
topping up.

Two sources, in order of how much they can be trusted:

* **A PDF's own text layer.** Exact — the characters are the ones the bank
  wrote, not a guess at their shapes. A monobank receipt has one (three
  `ToUnicode` CMaps over `Identity-H` CID fonts), so an uploaded PDF is read
  precisely.
* **Optical recognition**, for the photographs and screenshots that are the
  other half of what users upload.

Nothing here knows what a receipt code looks like. It returns text; which parts
of it are a code, and whose, is a per-bank question and belongs to the strategy
that answers it on the Node side.

**The text it returns is a payment credential.** A monobank receipt states the
recipient's card unmasked. It is passed to the caller and never logged.
"""

from __future__ import annotations

import io
import logging
import re

import pytesseract
from PIL import Image
from pypdf import PdfReader

LOGGER = logging.getLogger(__name__)

PDF_TEXT = "PDF_TEXT"
OCR = "OCR"

PDF_MAGIC = b"%PDF-"

# uk first: a Ukrainian receipt is mostly Ukrainian, and a code of Latin letters
# and digits is read correctly by either. Both are installed in the image.
OCR_LANGUAGES = "ukr+eng"

WHITESPACE = re.compile(r"\s+")

# Enough of a page to be worth recognising. Below this a "PDF text layer" is a
# handful of stray characters from a scanned page's metadata, and treating it as
# the document's text means never falling through to recognition.
MIN_USEFUL_TEXT = 24

# --- Ceilings ---------------------------------------------------------------
#
# The rlimits in `extract_worker.py` are the backstop; these are the ordinary
# refusals, so that an absurd document is declined in milliseconds instead of
# being ground against a memory ceiling for thirty seconds of CPU.

# A bank receipt is one or two pages. Ten is generous; a thousand-page PDF is not
# a receipt, whatever else it is.
MAX_PAGES = 10

# Images actually recognised. A PDF may embed hundreds; OCR of each is seconds,
# and a receipt's picture is the first one or two.
MAX_IMAGES = 8

# Pillow's own decompression-bomb guard, tightened. Its default is ~178 million
# pixels, which at four bytes each is most of the worker's memory ceiling spent
# before anything is recognised. Forty million still covers a 50-megapixel phone
# photograph.
Image.MAX_IMAGE_PIXELS = 40_000_000

# The longest text any caller has a use for. A receipt code lives in the first
# few hundred characters; the rest is a bound on what a crafted document can
# make this service hold and hand back.
MAX_TEXT_CHARS = 200_000


def extract(data: bytes) -> tuple[str, str]:
    """The text in a receipt, and which of the two sources it came from."""
    if data[: len(PDF_MAGIC)] == PDF_MAGIC:
        text = _from_pdf(data)
        if len(text) >= MIN_USEFUL_TEXT:
            return text, PDF_TEXT

        LOGGER.info("The PDF yielded %d characters of text; falling through to OCR", len(text))

        return _from_pdf_images(data), OCR

    return _from_image(data), OCR


def _pages(data: bytes) -> list:
    """The first {@link MAX_PAGES} pages, or none if the file will not open."""
    try:
        # `strict=False` is the tolerant mode. A receipt saved by a phone is
        # routinely a little malformed, and the alternative is refusing an
        # honest document over a detail no reader but this one would notice.
        reader = PdfReader(io.BytesIO(data), strict=False)

        return list(reader.pages)[:MAX_PAGES]
    except Exception:  # noqa: BLE001 - a stranger's upload; any failure is data
        LOGGER.warning("The PDF could not be opened", exc_info=True)

        return []


def _from_pdf(data: bytes) -> str:
    pages = []

    for page in _pages(data):
        try:
            pages.append(page.extract_text() or "")
        except Exception:  # noqa: BLE001
            # Per page, so one unreadable page does not lose the document. A
            # receipt's code is usually on the first.
            LOGGER.warning("A page's text could not be read", exc_info=True)

    return _normalise(" ".join(pages))


def _from_pdf_images(data: bytes) -> str:
    """Recognition over the images inside a PDF that carries no text.

    A receipt exported as a scan, or shared as a picture wrapped in a PDF. The
    embedded images are recognised directly rather than the pages being
    rasterised, which would need a PDF renderer this image does not carry.
    """
    recognised: list[str] = []

    for page in _pages(data):
        try:
            images = list(page.images)
        except Exception:  # noqa: BLE001
            LOGGER.warning("A page's images could not be listed", exc_info=True)
            continue

        for image in images:
            if len(recognised) >= MAX_IMAGES:
                LOGGER.info("Stopping at %d images; the rest is not a receipt", MAX_IMAGES)

                return _normalise(" ".join(recognised))

            recognised.append(_recognise(image.data))

    return _normalise(" ".join(recognised))


def _from_image(data: bytes) -> str:
    return _normalise(_recognise(data))


def _recognise(data: bytes) -> str:
    try:
        with Image.open(io.BytesIO(data)) as image:
            # Forces the decode here, inside the guard, rather than lazily
            # inside pytesseract where a malformed image would raise somewhere
            # this cannot see.
            image.load()

            return pytesseract.image_to_string(image, lang=OCR_LANGUAGES)
    except Exception:  # noqa: BLE001
        # Includes Pillow's DecompressionBombError, which is the point of the
        # ceiling above: a 4 GB canvas declared in a 30 kB file.
        LOGGER.warning("An image could not be recognised", exc_info=True)

        return ""


def _normalise(text: str) -> str:
    """One line, single-spaced, and bounded.

    A receipt's text arrives with the line breaks its layout had, and a code
    printed in groups can carry one inside it. Collapsing every run of
    whitespace to a single space is what lets the Node side match such a code —
    its pattern allows spacing around the dashes and strips it afterwards — and
    it costs nothing, since no bank's code contains whitespace of its own.
    """
    return WHITESPACE.sub(" ", text).strip()[:MAX_TEXT_CHARS]
