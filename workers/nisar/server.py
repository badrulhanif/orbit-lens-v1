"""
NISAR measurement service for Orbit Lens.

    npm run nisar:setup                 # once: Python packages in .venv
    npm run nisar                       # port 8787; token from .env.local

Then set NISAR_WORKER_URL=http://localhost:8787 for the Next.js app (and
EARTHDATA_TOKEN for this service, when deployed with Docker).

  GET /health
  GET /measure?urls=<GUNW .h5 URL>,...&bbox=w,s,e,n   one 12-day pair (its frames)
  GET /rate?urls=<url>,<url>,...&bbox=w,s,e,n          trend from several pairs
  GET /cover?a=<GCOV urls>&b=<GCOV urls>&bbox=…&boundary=<key>
                                                        land cover on two dates

If NISAR_WORKER_KEY is set, requests must send it as the X-Worker-Key header.
"""

from __future__ import annotations

import hmac
import json
import os
import threading
import time
import traceback
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


def _load_env_local():
    """Local dev: take EARTHDATA_TOKEN etc. from the app's .env.local."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../.env.local")
    if not os.path.exists(path):
        return
    with open(path) as fh:
        for line in fh:
            k, sep, v = line.strip().partition("=")
            if sep and not k.startswith("#") and k not in os.environ:
                os.environ[k] = v.strip().strip('"').strip("'")


_load_env_local()

import reader  # noqa: E402  (reads the token from the environment)

KEY = os.environ.get("NISAR_WORKER_KEY", "")
PORT = int(os.environ.get("PORT", "8787"))

# Finished answers as JSON bytes, newest last (products don't change once
# published). Bounded by count and by size: cover answers carry six
# base64 PNGs, so 300 of them could fill a small instance's memory.
_results: OrderedDict[str, tuple[float, bytes]] = OrderedDict()
_results_bytes = 0
_inflight: dict[str, threading.Event] = {}
_lock = threading.Lock()
TTL = 24 * 3600
MAX_RESULTS = 300
MAX_RESULT_BYTES = 150 << 20


def cached(key: str, make) -> bytes:
    global _results_bytes
    with _lock:
        hit = _results.get(key)
        if hit and time.time() - hit[0] < TTL:
            _results.move_to_end(key)
            return hit[1]
        waiting = _inflight.get(key)
        if not waiting:
            _inflight[key] = threading.Event()
    if waiting:  # Same request already running: wait for it.
        waiting.wait(300)
        return cached(key, make)
    try:
        value = json.dumps(make()).encode()
        with _lock:
            old = _results.pop(key, None)
            if old:
                _results_bytes -= len(old[1])
            _results[key] = (time.time(), value)
            _results_bytes += len(value)
            while len(_results) > MAX_RESULTS or (
                _results_bytes > MAX_RESULT_BYTES and len(_results) > 1
            ):
                _, (_, dropped) = _results.popitem(last=False)
                _results_bytes -= len(dropped)
        return value
    finally:
        with _lock:
            _inflight.pop(key).set()


# 6° a side, plus a little: callers round 6°-wide boxes to 4 decimals,
# which can come out at 6.0001.
MAX_SIDE = 6.001


def parse_bbox(text: str) -> list[float]:
    w, s, e, n = (round(float(v), 4) for v in text.split(","))
    if (
        not (-180 <= w < e <= 180 and -90 <= s < n <= 90)
        or e - w > MAX_SIDE
        or n - s > MAX_SIDE
    ):
        raise ValueError("bbox must be w,s,e,n and at most 6° a side")
    return [w, s, e, n]


def _urls(text: str | None, limit: int) -> list[str]:
    return [reader.check_url(u) for u in (text or "").split(",") if u][:limit]


def job(path: str, q: dict[str, str]):
    """(cache key, computation) for a request; ValueError when it's malformed."""
    bbox = parse_bbox(q.get("bbox", ""))
    urls = _urls(q.get("urls") or q.get("url"), 40)
    if path == "/measure":
        if not urls:
            raise ValueError("Need a product URL")
        return f"m|{','.join(sorted(urls))}|{bbox}", lambda: reader.measure(urls, bbox)
    if path == "/cover":
        a = _urls(q.get("a"), 8)
        b = _urls(q.get("b"), 8)
        if not a or not b:
            raise ValueError("Need products for both dates")
        boundary = q.get("boundary") or None
        key = f"c|{','.join(sorted(a))}|{','.join(sorted(b))}|{bbox}|{boundary}"
        return key, lambda: reader.cover(a, b, bbox, boundary)
    if len(urls) < 2:  # /rate
        raise ValueError("Need at least two pairs")
    return f"r|{','.join(sorted(urls))}|{bbox}", lambda: reader.rate(urls, bbox)


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict | bytes):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            # The caller gave up waiting; the answer is cached for next time.
            self.log_message("client went away before the answer (%d)", status)

    def do_GET(self):  # noqa: N802
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        if url.path == "/health":
            # Render sets RENDER_GIT_COMMIT: shows which code is running.
            commit = os.environ.get("RENDER_GIT_COMMIT", "")[:7] or "local"
            return self._send(
                200, {"ok": True, "token": bool(reader.TOKEN), "commit": commit}
            )
        given = self.headers.get("X-Worker-Key") or ""
        if KEY and not hmac.compare_digest(given.encode(), KEY.encode()):
            return self._send(401, {"error": "Unauthorised"})
        if url.path not in ("/measure", "/rate", "/cover"):
            return self._send(404, {"error": "Not found"})
        try:
            key, make = job(url.path, q)
        except ValueError as e:
            return self._send(400, {"error": str(e)})
        try:
            body = cached(key, make)
        except Exception as e:  # noqa: BLE001
            # Internal errors (numpy's included, many of which are
            # ValueErrors) are the service's fault, not the caller's.
            traceback.print_exc()
            self.log_error("failed: %r", e)
            return self._send(502, {"error": "Couldn't read the NISAR product."})
        return self._send(200, body)

    def log_message(self, fmt, *args):
        print(
            f"[nisar] {self.command} {self.path.split('?')[0]} " + fmt % args,
            flush=True,
        )


if __name__ == "__main__":
    if not reader.TOKEN:
        print("[nisar] EARTHDATA_TOKEN is not set; NASA will refuse downloads.")
    print(f"[nisar] listening on http://localhost:{PORT}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
