# Kronos Inference Service with FastAPI-or-HTTP fallback
# - If FastAPI/uvicorn are available, run a FastAPI app
# - Otherwise, fall back to a built-in http.server that exposes the same /forecast endpoint

from typing import List, Optional, Dict, Any
import math
import json

HOST = "127.0.0.1"
PORT = 8001


def clamp01(x: float) -> float:
    if not math.isfinite(x):
        return 0.0
    return max(0.0, min(1.0, x))


def simple_signal(ohlcv: List[List[float]]) -> Dict[str, float]:
    n = len(ohlcv)
    if n < 10:
        return {"long": 0.5, "short": 0.5, "conf": 0.4}

    closes = [row[4] for row in ohlcv[-200:]]  # up to last 200 closes
    n2 = len(closes)
    avg20 = sum(closes[-20:]) / max(1, min(20, n2))
    last = closes[-1]

    # momentum proxy: last close vs 20-avg; normalize by recent std-like proxy
    diffs = [abs(closes[i] - closes[i - 1]) for i in range(1, n2)]
    vol = (sum(diffs) / max(1, len(diffs))) or 1.0
    slope = (last - avg20) / vol
    # map slope to [0,1] via sigmoid-like
    long_score = 1.0 / (1.0 + math.exp(-slope))  # (0,1)
    short_score = 1.0 - long_score

    # confidence: grows with sample size and trend magnitude
    conf = min(0.9, 0.4 + 0.5 * clamp01(abs(slope) / 3.0) + 0.1 * clamp01(n / 480))

    return {"long": clamp01(long_score), "short": clamp01(short_score), "conf": clamp01(conf)}


def run_fallback_server():
    from http.server import BaseHTTPRequestHandler, HTTPServer
    import json as _json

    class FallbackHandler(BaseHTTPRequestHandler):
        def _send_json(self, code: int, payload: Dict[str, Any]):
            body = _json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            if self.path == "/health":
                self._send_json(200, {"status": "ok", "impl": "http.server"})
            else:
                self._send_json(404, {"error": "not_found"})

        def do_POST(self):  # noqa: N802
            if self.path != "/forecast":
                self._send_json(404, {"error": "not_found"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                raw = self.rfile.read(max(0, length))
                data = _json.loads(raw.decode("utf-8")) if raw else {}
                ohlcv = data.get("ohlcv") or []
                symbol = data.get("symbol") or "UNKNOWN"
                interval = data.get("interval") or "UNKNOWN"
                sig = simple_signal(ohlcv)
                resp = {
                    "score_long": sig["long"],
                    "score_short": sig["short"],
                    "confidence": sig["conf"],
                    "meta": {
                        "version": "0.1.0",
                        "interval": interval,
                        "symbol": symbol,
                        "n": len(ohlcv),
                        "impl": "http.server",
                    },
                }
                self._send_json(200, resp)
            except Exception as e:  # noqa: BLE001
                self._send_json(400, {"error": "bad_request", "message": str(e)})

    print(f"[Kronos] Starting built-in HTTP server on http://{HOST}:{PORT} (no FastAPI/uvicorn)")
    httpd = HTTPServer((HOST, PORT), FallbackHandler)
    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()

# Try to import FastAPI & pydantic; if unavailable, we'll fallback
FASTAPI_AVAILABLE = False
try:
    from fastapi import FastAPI
    from pydantic import BaseModel, Field
    FASTAPI_AVAILABLE = True
except Exception:
    FASTAPI_AVAILABLE = False


if FASTAPI_AVAILABLE:
    app = FastAPI(title="Kronos Inference Service", version="0.1.0")

    class ForecastRequest(BaseModel):
        symbol: str = Field(..., description="e.g. ETH-USDT-SWAP")
        interval: str = Field(..., description="e.g. 1H")
        # OHLCV rows: [timestamp(ms), open, high, low, close, volume]
        ohlcv: List[List[float]]

    class ForecastResponse(BaseModel):
        score_long: float
        score_short: float
        confidence: float
        meta: Optional[Dict[str, Any]] = None

    @app.post("/forecast", response_model=ForecastResponse)
    async def forecast(req: ForecastRequest):
        sig = simple_signal(req.ohlcv)
        return ForecastResponse(
            score_long=sig["long"],
            score_short=sig["short"],
            confidence=sig["conf"],
            meta={
                "version": "0.1.0",
                "interval": req.interval,
                "symbol": req.symbol,
                "n": len(req.ohlcv),
                "impl": "fastapi",
            },
        )

    def run_fallback_server():
        from http.server import BaseHTTPRequestHandler, HTTPServer
        import json as _json
    
        class FallbackHandler(BaseHTTPRequestHandler):
            def _send_json(self, code: int, payload: Dict[str, Any]):
                body = _json.dumps(payload).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
    
            def do_GET(self):  # noqa: N802
                if self.path == "/health":
                    self._send_json(200, {"status": "ok", "impl": "http.server"})
                else:
                    self._send_json(404, {"error": "not_found"})
    
            def do_POST(self):  # noqa: N802
                if self.path != "/forecast":
                    self._send_json(404, {"error": "not_found"})
                    return
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    raw = self.rfile.read(max(0, length))
                    data = _json.loads(raw.decode("utf-8")) if raw else {}
                    ohlcv = data.get("ohlcv") or []
                    symbol = data.get("symbol") or "UNKNOWN"
                    interval = data.get("interval") or "UNKNOWN"
                    sig = simple_signal(ohlcv)
                    resp = {
                        "score_long": sig["long"],
                        "score_short": sig["short"],
                        "confidence": sig["conf"],
                        "meta": {
                            "version": "0.1.0",
                            "interval": interval,
                            "symbol": symbol,
                            "n": len(ohlcv),
                            "impl": "http.server",
                        },
                    }
                    self._send_json(200, resp)
                except Exception as e:  # noqa: BLE001
                    self._send_json(400, {"error": "bad_request", "message": str(e)})
    
        print(f"[Kronos] Starting built-in HTTP server on http://{HOST}:{PORT} (no FastAPI/uvicorn)")
        httpd = HTTPServer((HOST, PORT), FallbackHandler)
        try:
            httpd.serve_forever()
        finally:
            httpd.server_close()

    if __name__ == "__main__":
        # Allow launching with: python app.py
        try:
            import uvicorn  # type: ignore
        except Exception as e:  # noqa: BLE001
            print("[Kronos] FastAPI available but uvicorn missing:", e)
            run_fallback_server()
        else:
            uvicorn.run("app:app", host=HOST, port=PORT, workers=1, log_level="info")

if not FASTAPI_AVAILABLE and __name__ == "__main__":
    run_fallback_server()