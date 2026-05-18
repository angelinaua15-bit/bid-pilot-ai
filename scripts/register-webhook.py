"""
scripts/register-webhook.py

Registers the Telegram Bot webhook with the deployed Vercel app URL.
Uses only Python stdlib — no packages required.
"""
import json
import os
import sys
import urllib.request
import urllib.error

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "8676026319:AAFmZ0kdiAPbMXLpsJJY6fN_uxZ78QxCN-0")
APP_URL   = os.environ.get("NEXT_PUBLIC_APP_URL", "https://v0-bidpilot-ai-saas.vercel.app").rstrip("/")
SECRET    = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "IvanivAngelina15032008")

WEBHOOK_URL = f"{APP_URL}/api/webhook"
API_BASE    = f"https://api.telegram.org/bot{BOT_TOKEN}"

def tg(method, payload=None):
    url = f"{API_BASE}/{method}"
    data = json.dumps(payload).encode() if payload else None
    headers = {"Content-Type": "application/json"} if data else {}
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode())
    except Exception as exc:
        return {"ok": False, "description": str(exc)}

def main():
    print("=" * 55)
    print("  BidPilot AI — Telegram Webhook Registration")
    print("=" * 55)
    print(f"Bot token (masked) : {BOT_TOKEN[:12]}...")
    print(f"App URL            : {APP_URL}")
    print(f"Webhook URL        : {WEBHOOK_URL}")
    print(f"Secret (masked)    : {SECRET[:4]}...")
    print()

    # 1. Verify bot token
    me = tg("getMe")
    if not me.get("ok"):
        print(f"ERROR: getMe failed — {me.get('description', 'invalid token?')}")
        sys.exit(1)
    bot = me["result"]
    print(f"Bot verified       : {bot['first_name']} (@{bot.get('username', 'N/A')})")
    print(f"Bot ID             : {bot['id']}")
    print()

    # 2. Set webhook
    result = tg("setWebhook", {
        "url": WEBHOOK_URL,
        "secret_token": SECRET,
        "allowed_updates": ["message", "callback_query", "inline_query"],
        "drop_pending_updates": True,
    })
    print("setWebhook response:")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    print()

    if not result.get("ok"):
        print(f"ERROR: {result.get('description', 'unknown error')}")
        sys.exit(1)

    # 3. Verify registration
    info = tg("getWebhookInfo")
    wi = info.get("result", {})
    print("Webhook info:")
    print(f"  url                  : {wi.get('url', '(none)')}")
    print(f"  pending_update_count : {wi.get('pending_update_count', 0)}")
    print(f"  last_error_message   : {wi.get('last_error_message', '(none)')}")
    print(f"  max_connections      : {wi.get('max_connections', 'N/A')}")
    print()

    registered_url = wi.get("url", "")
    if registered_url == WEBHOOK_URL:
        print("SUCCESS: Webhook registered and verified.")
        print()
        print("Next step — open your bot in Telegram and send /start:")
        print(f"  https://t.me/{bot.get('username', 'your_bot')}")
    else:
        print(f"WARNING: registered URL does not match.")
        print(f"  expected : {WEBHOOK_URL}")
        print(f"  got      : {registered_url}")

if __name__ == "__main__":
    main()
