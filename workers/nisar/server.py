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

import json
import os
import threading
import time
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

# Finished answers, newest last (products don't change once published).
_results: OrderedDict[str, tuple[float, dict]] = OrderedDict()
_inflight: dict[str, threading.Event] = {}
_lock = threading.Lock()
TTL = 24 * 3600


def cached(key: str, make):
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
        value = make()
        with _lock:
            _results[key] = (time.time(), value)
            while len(_results) > 300:
                _results.popitem(last=False)
        return value
    finally:
        with _lock:
            _inflight.pop(key).set()


def parse_bbox(text: str) -> list[float]:
    w, s, e, n = (float(v) for v in text.split(","))
    if not (-180 <= w < e <= 180 and -90 <= s < n <= 90) or e - w > 3 or n - s > 3:
        raise ValueError("bbox must be w,s,e,n and at most 3° a side")
    return [round(v, 4) for v in (w, s, e, n)]


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # noqa: N802
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        if url.path == "/health":
            return self._send(200, {"ok": True, "token": bool(reader.TOKEN)})
        if KEY and self.headers.get("X-Worker-Key") != KEY:
            return self._send(401, {"error": "Unauthorised"})
        try:
            bbox = parse_bbox(q.get("bbox", ""))
            urls = [
                reader.check_url(u)
                for u in (q.get("urls") or q.get("url") or "").split(",")
                if u
            ][:32]
            if url.path == "/measure":
                if not urls:
                    raise ValueError("Need a product URL")
                key = f"m|{','.join(sorted(urls))}|{bbox}"
                body = cached(key, lambda: reader.measure(urls, bbox))
            elif url.path == "/cover":
                a = [reader.check_url(u) for u in q.get("a", "").split(",") if u][:6]
                b = [reader.check_url(u) for u in q.get("b", "").split(",") if u][:6]
                if not a or not b:
                    raise ValueError("Need products for both dates")
                boundary = q.get("boundary") or None
                key = f"c|{','.join(sorted(a))}|{','.join(sorted(b))}|{bbox}|{boundary}"
                body = cached(key, lambda: reader.cover(a, b, bbox, boundary))
            elif url.path == "/rate":
                if len(urls) < 2:
                    raise ValueError("Need at least two pairs")
                key = f"r|{','.join(sorted(urls))}|{bbox}"
                body = cached(key, lambda: reader.rate(urls, bbox))
            else:
                return self._send(404, {"error": "Not found"})
            return self._send(200, body)
        except ValueError as e:
            return self._send(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            import traceback

            traceback.print_exc()
            self.log_error("failed: %r", e)
            return self._send(502, {"error": "Couldn't read the NISAR product."})

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
