# python-oracledb runs in thin mode, so there is no Oracle Instant Client to
# install and no reason for this image to be anything but slim.
FROM python:3.12-slim

# Unbuffered so container logs appear in order; no .pyc because the filesystem
# is read-only at runtime.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY oracle_mcp ./oracle_mcp

# This process reads a mounted secret and connects to a production database.
# It has no reason to run as root, and no reason to be able to write to its own
# code: an unprivileged user plus a read-only root filesystem (set in the
# compose file) means a flaw here cannot persist anything.
RUN useradd --create-home --uid 10001 oraclemcp
USER oraclemcp

EXPOSE 8900

# /healthz is served before the auth middleware and reports only that the
# process is up -- it deliberately does not touch Oracle, so a database blip
# does not make the container get restarted out from under the connection pool.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; \
        sys.exit(0) if urllib.request.urlopen('http://127.0.0.1:8900/healthz', timeout=4).status == 204 else sys.exit(1)"

CMD ["python", "-m", "oracle_mcp.server"]
