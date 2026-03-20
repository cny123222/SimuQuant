#!/usr/bin/env python3
"""
One-shot script to create and start the default SJTU match.

Usage:
    python scripts/setup_default.py --host localhost:8000 --key <admin-api-key>

If the session "SJTU 默认比赛" already exists, it reuses it and
starts any PENDING round (or reports the already-active round ID).
"""
from __future__ import annotations

import argparse
import sys
import httpx

SESSION_NAME = "SJTU 默认比赛"
ROUND_CONFIG = {
    "round_number": 1,
    "name": "Round 1 — SJTU-A / SJTU-B",
    "duration_seconds": 3600,   # 1 hour
    "tickers_config": [
        {
            "ticker": "SJTU-A",
            "initial_price": 100.0,
            "volatility": 0.018,
            "drift": 0.0,
            "jump_intensity": 0.01,
            "jump_size": 0.04,
            "settlement_price": None,
            "allowed_order_types": [],
            "max_orders_per_second": None,
            "max_order_quantity": None,
            "price_ref_ticker": None,
            "price_multiplier": 1.0,
            "residual_volatility": 0.005,
            "is_etf": False,
            "etf_lot_size": 10,
            "etf_basket": [],
            "etf_fee": 0.0,
        },
        {
            "ticker": "SJTU-B",
            "initial_price": 50.0,
            "volatility": 0.022,
            "drift": 0.0,
            "jump_intensity": 0.015,
            "jump_size": 0.05,
            "settlement_price": None,
            "allowed_order_types": [],
            "max_orders_per_second": None,
            "max_order_quantity": None,
            "price_ref_ticker": None,
            "price_multiplier": 1.0,
            "residual_volatility": 0.005,
            "is_etf": False,
            "etf_lot_size": 10,
            "etf_basket": [],
            "etf_fee": 0.0,
        },
    ],
    # Bots
    "mm_bot_count": 3,
    "noise_bot_count": 2,
    "mm_spread": 0.10,
    "mm_order_size": 10,
    # Trading rules
    "order_fee": 0.0,
    "max_order_quantity": 50,     # max 50 shares per order
    "max_orders_per_second": 5,   # 5 orders / second per user per ticker
    "max_position": 200,          # position limit ±200 per ticker
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Set up the default SJTU match")
    parser.add_argument("--host", default="localhost:8000", help="Backend host:port")
    parser.add_argument("--key", required=True, help="Admin API key")
    args = parser.parse_args()

    base = f"http://{args.host}/api"
    headers = {"X-Api-Key": args.key, "Content-Type": "application/json"}

    with httpx.Client(headers=headers, timeout=15) as client:
        # ── Health check ──────────────────────────────────────────────────────
        try:
            r = client.get(f"{base}/health")
            r.raise_for_status()
            print(f"✓ Backend online: {r.json()}")
        except Exception as e:
            print(f"✗ Cannot reach backend at {base}: {e}")
            sys.exit(1)

        # ── Find or create session ────────────────────────────────────────────
        sessions = client.get(f"{base}/sessions").json()
        session = next((s for s in sessions if s["name"] == SESSION_NAME), None)

        if session is None:
            session = client.post(f"{base}/sessions", json={"name": SESSION_NAME}).json()
            print(f"✓ Created session: {session['name']} (id={session['id']})")
        else:
            print(f"→ Reusing session: {session['name']} (id={session['id']})")

        sid = session["id"]

        # ── Find or create round ──────────────────────────────────────────────
        rounds = client.get(f"{base}/sessions/{sid}/rounds").json()

        active = [r for r in rounds if r["status"] == "ACTIVE"]
        if active:
            r = active[0]
            print(f"✓ Round already active: '{r['name']}' (id={r['id']})")
            _print_result(args.host, r["id"])
            return

        pending = [r for r in rounds if r["status"] == "PENDING"]
        if pending:
            rnd = pending[0]
            print(f"→ Found pending round: '{rnd['name']}' (id={rnd['id']})")
        else:
            rnd = client.post(f"{base}/sessions/{sid}/rounds", json=ROUND_CONFIG).json()
            print(f"✓ Created round: '{rnd['name']}' (id={rnd['id']})")

        # ── Start the round ───────────────────────────────────────────────────
        started = client.post(
            f"{base}/sessions/{sid}/rounds/{rnd['id']}/start"
        ).json()
        print(f"✓ Round started: status={started['status']}")
        _print_result(args.host, rnd["id"])


def _print_result(host: str, round_id: int) -> None:
    print()
    print("=" * 60)
    print(f"  Round ID : {round_id}")
    print(f"  Viewer   : http://{host}/viewer/{round_id}")
    print(f"  Trade    : http://{host}/trade/{round_id}")
    print("=" * 60)
    print()
    print("Tickers: SJTU-A (init=100) · SJTU-B (init=50)")
    print("Rules  : max_position=±200 · max_orders/s=5 · max_qty/order=50")


if __name__ == "__main__":
    main()
