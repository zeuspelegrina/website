#!/usr/bin/env python3
"""
Volume Society Macro Space — local dashboard server.

Serves the static UI and proxies two free public feeds so the browser never
has to fight CORS:

  * FRED CSV download endpoint (no API key required for these series)
  * ForexFactory weekly economic calendar JSON

Run:
    python3 server.py
    python3 server.py --port 8787
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE_DIR = ROOT / "cache"
CACHE_DIR.mkdir(exist_ok=True)

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

# Only these series can be requested. Keeps the proxy from becoming an
# open fetch service.
ALLOWED_SERIES = {
    # nominal curve
    "DGS1MO", "DGS3MO", "DGS6MO", "DGS1", "DGS2", "DGS3", "DGS5",
    "DGS7", "DGS10", "DGS20", "DGS30",
    # curve spreads
    "T10Y2Y", "T10Y3M", "T5YIFR",
    # real yields + inflation compensation
    "DFII5", "DFII10", "DFII30", "T5YIE", "T10YIE",
    # policy + money market
    "DFF", "EFFR", "SOFR", "IORB", "DFEDTARU", "DFEDTARL",
    # financial conditions + credit
    "NFCI", "NFCILEVERAGE", "NFCICREDIT", "NFCIRISK",
    "BAMLH0A0HYM2", "BAMLC0A0CM",
    # volatility / risk
    "VIXCLS", "SP500",
    # inflation / labour / growth
    "CPIAUCSL", "CPILFESL", "PCEPILFE", "UNRATE", "PAYEMS", "GDPC1",
    # liquidity
    "WALCL", "RRPONTSYD", "MORTGAGE30US", "DTWEXBGS", "DCOILWTICO",
}

DEFAULT_SERIES = [
    "DGS1MO", "DGS3MO", "DGS6MO", "DGS1", "DGS2", "DGS3", "DGS5",
    "DGS7", "DGS10", "DGS20", "DGS30", "T10Y2Y", "T10Y3M", "T5YIFR",
    "DFII5", "DFII10", "DFII30", "T5YIE", "T10YIE",
    "DFF", "EFFR", "SOFR", "IORB", "DFEDTARU", "DFEDTARL",
    "NFCI", "NFCILEVERAGE", "NFCICREDIT", "NFCIRISK",
    "BAMLH0A0HYM2", "BAMLC0A0CM", "VIXCLS", "SP500",
    "CPIAUCSL", "CPILFESL", "PCEPILFE", "UNRATE", "PAYEMS", "GDPC1",
    "WALCL", "RRPONTSYD", "MORTGAGE30US", "DTWEXBGS", "DCOILWTICO",
]

FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv"
FF_CAL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"


# --------------------------------------------------------------------------- #
# fetch helpers
# --------------------------------------------------------------------------- #

def _curl(url: str, timeout: int = 20) -> bytes:
    proc = subprocess.run(
        ["curl", "-sS", "--http1.1", "--retry", "1", "--retry-delay", "1",
         "--max-time", str(timeout), url],
        capture_output=True,
        stdin=subprocess.DEVNULL,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError(proc.stderr.decode(errors="ignore").strip() or "curl failed")
    return proc.stdout


def fetch_bytes(url: str, ttl: int = 600, timeout: int = 30) -> bytes:
    """GET with a small disk cache. curl first: reliable TLS on macOS."""
    key = hashlib.sha1(url.encode()).hexdigest()[:16]
    path = CACHE_DIR / (key + ".bin")

    if path.exists() and (time.time() - path.stat().st_mtime) < ttl:
        return path.read_bytes()

    body = None
    try:
        body = _curl(url, timeout)
    except Exception:
        req = urllib.request.Request(url, headers={"Accept": "*/*"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()

    if not body:
        raise RuntimeError("empty response")
    path.write_bytes(body)
    return body


# --------------------------------------------------------------------------- #
# FRED
# --------------------------------------------------------------------------- #

def _parse_fred_csv(raw: bytes, sid: str) -> list:
    text = raw.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        return []

    header = [h.strip() for h in rows[0]]
    if not header or header[0].lower() not in ("observation_date", "date"):
        return []

    # Prefer the named column; fall back to the second column.
    col = 1
    for i, h in enumerate(header[1:], start=1):
        if h == sid:
            col = i
            break

    out = []
    for row in rows[1:]:
        if not row or not row[0] or col >= len(row):
            continue
        cell = row[col].strip()
        if not cell or cell == ".":
            continue
        try:
            val = float(cell)
        except ValueError:
            continue
        day = row[0].strip()
        if out and out[-1][0] == day:
            out[-1] = [day, val]
        else:
            out.append([day, val])

    out.sort(key=lambda p: p[0])
    return out


def fred_payload(series_ids: list[str], years: int = 6) -> dict:
    """Fetch each series separately (small responses, resilient to one bad ID)."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    start = (date.today() - timedelta(days=int(years * 365.25) + 45)).isoformat()
    out = {}
    errors = {}

    def one(sid):
        url = FRED_CSV + "?id=" + urllib.parse.quote(sid) + "&cosd=" + start
        raw = fetch_bytes(url, ttl=600)
        return _parse_fred_csv(raw, sid)

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(one, sid): sid for sid in series_ids}
        for fut in as_completed(futures):
            sid = futures[fut]
            try:
                out[sid] = fut.result()
            except Exception as exc:
                out[sid] = []
                errors[sid] = str(exc)

    latest_dates = [p[-1][0] for p in out.values() if p]
    payload = {
        "ok": bool(latest_dates),
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "start": start,
        "latest": max(latest_dates) if latest_dates else None,
        "series": out,
        "source": "FRED / Federal Reserve Bank of St. Louis",
    }
    if errors:
        payload["errors"] = errors
        if not latest_dates:
            payload["error"] = next(iter(errors.values()))
    return payload


# --------------------------------------------------------------------------- #
# calendar
# --------------------------------------------------------------------------- #

IMPACTS = {"High", "Medium", "Low", "Holiday"}


def calendar_payload() -> dict:
    try:
        raw = fetch_bytes(FF_CAL, ttl=1800).decode("utf-8", errors="replace")
        events = json.loads(raw)
        clean = []
        for e in events if isinstance(events, list) else []:
            title = str(e.get("title") or "").strip()
            when = str(e.get("date") or "").strip()
            if not title or not when:
                continue
            impact = str(e.get("impact") or "").strip().title()
            clean.append({
                "title": title,
                "country": str(e.get("country") or "").strip().upper(),
                "date": when,
                "impact": impact if impact in IMPACTS else "Low",
                "forecast": str(e.get("forecast") or "").strip(),
                "previous": str(e.get("previous") or "").strip(),
                "actual": str(e.get("actual") or "").strip(),
            })
        clean.sort(key=lambda x: x["date"])
        return {
            "ok": True,
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "events": clean,
            "source": "ForexFactory calendar (weekly feed)",
        }
    except Exception as exc:
        fallback = ROOT / "data" / "calendar.json"
        if fallback.exists():
            return json.loads(fallback.read_text())
        return {"ok": False, "error": str(exc), "events": []}


# --------------------------------------------------------------------------- #
# data providers
# --------------------------------------------------------------------------- #

def _env_flag(*names: str) -> bool:
    return any(bool(os.environ.get(n, "").strip()) for n in names)


def providers_payload() -> dict:
    """Report which data vendors are usable right now.

    Nothing is bundled: key-gated vendors stay dormant until the matching
    environment variables are present, and the UI says so.
    """
    tradier = _env_flag("TRADIER_TOKEN", "TRADIER_API_KEY")
    tiingo = _env_flag("TIINGO_TOKEN", "TIINGO_API_KEY")
    iex = _env_flag("IEX_TOKEN", "IEX_API_KEY")
    sec_ua = _env_flag("SEC_USER_AGENT")
    finviz = _env_flag("FINVIZ_API_KEY")

    providers = {
        "fred": {
            "label": "FRED",
            "status": "LIVE",
            "tone": "live",
            "connected": True,
            "env": [],
            "note": "Public CSV endpoint, no key required.",
        },
        "forexfactory": {
            "label": "ForexFactory",
            "status": "LIVE",
            "tone": "live",
            "connected": True,
            "env": [],
            "note": "Weekly calendar feed, no key required.",
        },
        "tradier": {
            "label": "Tradier",
            "status": "ACTIVE" if tradier else "KEY REQUIRED",
            "tone": "live" if tradier else "key",
            "connected": tradier,
            "env": ["TRADIER_TOKEN"],
            "note": "Real-time SIP quotes, options chains, Greeks and IV." if tradier
                    else "Set TRADIER_TOKEN to enable real-time SIP quotes and options.",
        },
        "tiingo_iex": {
            "label": "Tiingo & IEX",
            "status": "ACTIVE" if (tiingo and iex) else "PARTIAL" if (tiingo or iex) else "KEY REQUIRED",
            "tone": "live" if (tiingo and iex) else "key",
            "connected": bool(tiingo and iex),
            "env": ["TIINGO_TOKEN", "IEX_TOKEN"],
            "note": "Supplementary market feeds ready." if (tiingo and iex)
                    else "Set TIINGO_TOKEN and IEX_TOKEN for supplementary market feeds.",
        },
        "sec_edgar": {
            "label": "SEC EDGAR",
            "status": "UA SET" if sec_ua else "FREE API",
            "tone": "free",
            "connected": True,
            "env": ["SEC_USER_AGENT"],
            "note": "Free public API. Set SEC_USER_AGENT for polite, identified requests.",
        },
        "finviz_financedatabase": {
            "label": "Finviz & FinanceDatabase",
            "status": "ACTIVE" if finviz else "ATTRIBUTION",
            "tone": "free" if finviz else "attribution",
            "connected": True,
            "env": ["FINVIZ_API_KEY"],
            "note": "Screening and ETF indexing. FinanceDatabase is an optional Python package.",
        },
    }

    live = sum(1 for p in providers.values() if p["tone"] == "live")
    keyed = sum(1 for p in providers.values() if p["tone"] == "key")
    open_src = sum(1 for p in providers.values() if p["tone"] in ("free", "attribution"))
    missing = [
        name
        for p in providers.values()
        if p["tone"] == "key"
        for name in p["env"]
        if not os.environ.get(name, "").strip()
    ]

    if keyed == 0:
        summary = f"{live} ACTIVE · ALL FEEDS CONFIGURED"
        detail = "All keyed vendors are configured."
    else:
        summary = f"{live} LIVE · {keyed} KEY OPTIONAL · {open_src} OPEN"
        detail = "Unlock real-time quotes & options: " + " · ".join(dict.fromkeys(missing))

    return {
        "ok": True,
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "providers": providers,
        "counts": {"live": live, "keyed": keyed, "open": open_src},
        "summary": summary,
        "detail": detail,
    }


# --------------------------------------------------------------------------- #
# ai agent (Gemini)
# --------------------------------------------------------------------------- #

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_GEMINI_MODEL = os.environ.get("GEMINI_MODEL") or "gemini-2.5-flash"
GEMINI_MODELS = [
    DEFAULT_GEMINI_MODEL,
    "gemini-2.0-flash",
]
GEMINI_KEY_ENV = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GEMINI_TOKEN"]

AGENT_SYSTEM = (
    "You are the Gemini macro agent inside the Volume Society Macro Space, a "
    "transparent, cool-black macro dashboard. You answer concisely (2-4 sentences "
    "when asked for a read, longer only when asked for detail). Base every answer on "
    "the macro context supplied in the conversation. Never invent numbers, levels or "
    "trends that are not in the context. If the context is missing a value, say so "
    "honestly instead of guessing. Be direct, use short macro terms (real yields, "
    "curve, NFCI, credit, VIX, liquidity, policy) naturally. End every substantive "
    "answer with a brief one-line caveat that this is for information and research "
    "only, not investment advice."
)


def _first_env(names: list) -> str:
    for n in names:
        v = (os.environ.get(n) or "").strip()
        if v:
            return v
    return ""


def gemini_reply(message: str, history: list, context: dict):
    """Call Gemini. Returns (reply_text, model_used). Raises on failure."""
    api_key = _first_env(GEMINI_KEY_ENV)
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")

    contents = []
    for turn in history or []:
        role = "user" if str(turn.get("role") or "user").lower() == "user" else "model"
        text = str(turn.get("content") or "").strip()
        if text:
            contents.append({"role": role, "parts": [{"text": text}]})
    contents.append({"role": "user", "parts": [{"text": message}]})

    user_text = (
        "Dashboard context (live macro snapshot — do not treat as news):\n"
        + json.dumps(context or {}, default=str)[:1800]
        + "\n\nUser question: " + (message or "")
    )

    last_err = None
    for model in GEMINI_MODELS:
        body = {
            "systemInstruction": {"parts": [{"text": AGENT_SYSTEM}]},
            "contents": [
                {"role": "user", "parts": [{"text": user_text}]},
            ],
            "generationConfig": {"temperature": 0.45, "maxOutputTokens": 420},
        }
        if contents and model:
            body["contents"] = contents

        req = urllib.request.Request(
            f"{GEMINI_BASE}/{model}:generateContent?key={api_key}",
            data=json.dumps(body).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = json.loads(resp.read().decode("utf-8", errors="replace"))
        except Exception as exc:
            last_err = exc
            continue

        cand = payload.get("candidates") or []
        part = (cand[0].get("content") or {}).get("parts") or [] if cand else []
        text_out = "".join(p.get("text") or "" for p in part).strip()
        if text_out:
            return text_out, model
        last_err = RuntimeError("empty Gemini response")

    raise last_err or RuntimeError("Gemini unavailable")


def local_agent_reply(message: str, context: dict) -> str:
    """Deterministic fallback used when no Gemini key is configured."""
    m = (message or "").lower()
    sent = context or {}
    mets = sent.get("metrics") or {}
    ndq = sent.get("sentiment") or {}
    btc = sent.get("sentiment") or {}
    btc = btc if isinstance(btc, dict) else {}
    ndq = ndq if isinstance(ndq, dict) else {}
    brief = sent.get("brief") or "The macro tape is still loading — the dashboard is gathering its inputs."

    hit = None
    if any(w in m for w in ("bitcoin", "btc", "risk-on", "risk off", "riskoff")):
        hit = "btc"
    elif any(w in m for w in ("nasdaq", "ndx", "sp500", "s&p", "tech", "equity", "equities", "growth")):
        hit = "ndq"
    elif any(w in m for w in ("curve", "2s10s", "2s3m", "treasury", "yield curve")):
        hit = "curve"
    elif any(w in m for w in ("real", "tips", "breakeven", "inflation", "dfii")):
        hit = "real"
    elif any(w in m for w in ("vix", "volatil", "vol", "fear", "greed")):
        hit = "vix"
    elif any(w in m for w in ("credit", "hy", "oas", "spread", "lend")):
        hit = "credit"
    elif any(w in m for w in ("liquidity", "fed", "balance", "rpp", "rrp", "walcl", "policy", "fed funds", "effr")):
        hit = "policy"

    if hit == "btc":
        bias = btc.get("daily") or btc.get("intraday") or "NEUTRAL"
        net = (btc.get("net") or "")
        lines = [brief, f"Right now the dashboard's model leans {bias} on BTC — {net} across horizons." ]
        return " ".join(lines).rstrip(" .") + " This is derived from macro conditions, not a price forecast. For information and research only, not investment advice."
    if hit == "ndq":
        bias = ndq.get("daily") or ndq.get("intraday") or "NEUTRAL"
        return f"{brief} The model currently leans {str(bias).lower()} on the Nasdaq across horizons. For information and research only, not investment advice."

    if hit == "curve":
        c = mets.get("curve2s10s")
        c3 = mets.get("curve2s3m")
        line = f"The 2s10s spread is at {c if c is None else round(c, 2)}% and the 2s3m at {c3 if c3 is None else round(c3, 2)}%."
        return f"{line} The dashboard classifies this as a {'restrictive' if (c or 0) < 0 else 'supportive'} curve backdrop for risk assets. For information and research only, not investment advice."

    if hit == "real":
        r = mets.get("real10")
        return f"10Y real yields sit near {r if r is None else round(r, 2)}%. The breakeven is near {mets.get('breakeven10') if mets.get('breakeven10') is None else round(mets.get('breakeven10'), 2)}%. Real yields are the main lever for growth multiples. For information and research only, not investment advice."

    if hit == "vix":
        v = mets.get("vix")
        return f"VIX is around {v if v is None else round(v, 1)}. Volatility readings stay inside the dashboard's calm-to-contained range. For information and research only, not investment advice."

    if hit == "credit":
        hy = mets.get("hyOasBp")
        return f"HY OAS is around {hy if hy is None else round(hy, 0)}bp. Credit spreads are inside the dashboard's tolerance band for risk assets. For information and research only, not investment advice."

    if hit == "policy":
        ef = "Fed funds (EFFR)"
        return f"Policy signals: {ef} context and liquidity measures feed the dashboard's regime read. For information and research only, not investment advice."

    return brief


def agent_reply(message: str, context: dict):
    """Returns dict: {ok, mode, model, reply}."""
    try:
        reply, model = gemini_reply(message, [], context)
        return {"ok": True, "mode": "gemini", "model": model, "reply": reply}
    except Exception:
        try:
            return {"ok": True, "mode": "local", "model": "local-fallback", "reply": local_agent_reply(message, context)}
        except Exception:
            return {"ok": False, "mode": "error", "reply": "The macro agent could not answer right now. Try again in a moment."}


# --------------------------------------------------------------------------- #
# ai agent
# --------------------------------------------------------------------------- #

def agent_status() -> dict:
    api_key = _first_env(GEMINI_KEY_ENV)
    return {
        "ok": True,
        "provider": "gemini",
        "configured": bool(api_key),
        "mode": "gemini" if api_key else "local",
        "model": (os.environ.get("GEMINI_MODEL") or DEFAULT_GEMINI_MODEL) if api_key else "local-fallback",
        "note": "Gemini answers from the live dashboard context when GEMINI_API_KEY is set; local fallback otherwise.",
    }


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #

class Handler(SimpleHTTPRequestHandler):
    server_version = "VolumeSocietyMacro/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        if os.environ.get("MACRO_VERBOSE"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _json(self, obj, status=200):
        body = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/health":
            return self._json({"ok": True, "time": datetime.now(timezone.utc).isoformat()})

        if parsed.path == "/api/macro":
            qs = urllib.parse.parse_qs(parsed.query)
            requested = []
            for chunk in ",".join(qs.get("series", [])).split(","):
                sid = chunk.strip().upper()
                if sid in ALLOWED_SERIES and sid not in requested:
                    requested.append(sid)
            if not requested:
                requested = DEFAULT_SERIES[:]
            try:
                years = max(1, min(12, int(qs.get("years", ["6"])[0])))
            except ValueError:
                years = 6
            try:
                return self._json(fred_payload(requested, years))
            except Exception as exc:
                return self._json({"ok": False, "error": str(exc), "series": {}}, 502)

        if parsed.path == "/api/calendar":
            return self._json(calendar_payload())

        if parsed.path == "/api/providers":
            return self._json(providers_payload())

        if parsed.path == "/api/agent":
            return self._json(agent_status())

        if parsed.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8", errors="replace")) if raw else {}
        except Exception:
            payload = {}
        if parsed.path == "/api/agent":
            try:
                return self._json(agent_reply(str(payload.get("message") or ""), payload.get("context") or {}))
            except Exception as exc:
                return self._json({"ok": False, "error": str(exc)}, 502)
        if parsed.path == "/api/providers":
            return self._json(providers_payload())
        return self._json({"ok": False, "error": "not found"}, 404)

    def end_headers(self):
        if self.path.endswith((".html", ".js", ".css")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    ap = argparse.ArgumentParser(description="Volume Society Macro Space")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8787")))
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"\n  Volume Society Macro Space\n  http://{args.host}:{args.port}\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped")
        httpd.server_close()


if __name__ == "__main__":
    main()
