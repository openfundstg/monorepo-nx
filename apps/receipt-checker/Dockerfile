# A current base, for the one job left: parsing files strangers upload.
#
# **This image used to carry Chrome**, because `check.gov.ua` would not answer a
# request without a reCAPTCHA token minted by its own page. That verifier is
# gone — monobank's certification service proves a receipt by the signature on
# it — and with it went the browser, its driver, the fifteen X libraries it
# needed, the seccomp profile that let its sandbox start, and a gigabyte of
# image. What is left parses PDFs and images and reaches nothing.
FROM python:3.13-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1

# The OCR engine, and nothing else.
#
# tesseract's language data is installed into the image rather than fetched at
# runtime — this container has no route to the internet at all, and an OCR
# engine that downloaded its own data on first use would fail in a way that
# looks like an unreadable receipt.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        tesseract-ocr tesseract-ocr-ukr tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY apps/receipt-checker/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/receipt-checker/ ./

# **Nothing here runs as root.** A bug in a PDF parser or in a browser rendering
# a page we do not control should be a dead end, not a foothold: the account
# below owns no code, and the code it runs is read-only to it.
RUN useradd --create-home --shell /usr/sbin/nologin checker \
    && chmod -R a-w,a+rX /app \
    && mkdir -p /home/checker/tmp /home/checker/run \
    && chown -R checker:checker /home/checker

USER checker

# The code is read-only and the working directory is not the code.
#
# A parser handed a hostile file should have nowhere to write that outlives it,
# so `/app` is read-only and the process runs somewhere else. `PYTHONPATH` is
# what keeps the modules importable from there.
WORKDIR /home/checker/run

ENV RECEIPT_CHECKER_PORT=8100 \
    HOME=/home/checker \
    TMPDIR=/home/checker/tmp \
    PYTHONPATH=/app

EXPOSE 8100

# Waitress rather than Flask's development server: this is a real service on the
# compose network, and the development server says so on every boot for a reason.
CMD ["python", "-m", "app"]
