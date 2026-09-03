#!/usr/bin/env python3
"""OF-1 deterministic browser proof.

Run: python3 scripts/of1-browser-evidence.py
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "04-QA-Evidence" / "Flow2" / "OF-1"
SCREENSHOT = "01-clicked-professionals-opened-details.png"


class BuilderHandler(SimpleHTTPRequestHandler):
    """Serve builder/ at the production-shaped /app/ URL."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):  # noqa: N802 - stdlib handler API
        parsed = urlsplit(self.path)
        if parsed.path == "/app":
            self.send_response(302)
            self.send_header("Location", "/app/")
            self.end_headers()
            return
        if parsed.path.startswith("/app/"):
            mapped = "/builder/" + parsed.path[len("/app/") :]
            self.path = urlunsplit(("", "", mapped, parsed.query, parsed.fragment))
        super().do_GET()

    def log_message(self, format, *args):  # noqa: A002 - stdlib handler API
        del format, args
        return


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), BuilderHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/app/"

    candidates = [
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ]
    executable = next((candidate for candidate in candidates if os.path.exists(candidate)), None)

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, executable_path=executable)
            try:
                page = browser.new_page(viewport={"width": 1440, "height": 1000})
                page.goto(url, wait_until="networkidle", timeout=30_000)
                selector = '.template-card[data-template-id="professionals"] .btn-start-tpl'
                page.locator(selector).click()
                page.wait_for_url("**/#edit")
                page.locator("#details-drawer").wait_for(state="visible")

                drawer_text = page.locator("#drawer-body").inner_text()
                assert "Imagine pentru partajare socială" not in drawer_text
                assert "seo.ogImage" not in drawer_text

                frame = page.frame_locator("#preview-iframe")
                og_image = frame.locator('meta[property="og:image"]').get_attribute("content")
                twitter_image = frame.locator('meta[name="twitter:image"]').get_attribute("content")
                expected_suffix = "/template-assets/professionals/images/hero.jpg"
                assert og_image and og_image.endswith(expected_suffix), f"unexpected preview og:image: {og_image!r}"
                assert twitter_image == og_image, "preview social image tags disagree"
                image_response = page.request.get(urljoin(url, og_image))
                assert image_response.ok, f"preview social image returned HTTP {image_response.status}"
                assert image_response.headers.get("content-type", "").startswith("image/"), "social image is not an image response"

                page.screenshot(path=str(OUT / SCREENSHOT), full_page=True)
                steps = [
                    {
                        "step": "clicked-professionals-opened-details",
                        "action": f"click {selector}",
                        "screenshot": SCREENSHOT,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "checks": {
                            "route": page.evaluate("window.location.hash"),
                            "detailsVisible": page.locator("#details-drawer").is_visible(),
                            "socialImageFieldAbsent": True,
                            "ogImageDerivedFromHero": True,
                            "ogImageAssetHttpStatus": image_response.status,
                            "twitterImageMatches": True,
                        },
                    }
                ]
                (OUT / "evidence.json").write_text(
                    json.dumps({"url": url, "steps": steps}, indent=2) + "\n",
                    encoding="utf-8",
                )
                print(json.dumps({"screenshot": str(OUT / SCREENSHOT), "steps": steps}, indent=2))
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


if __name__ == "__main__":
    main()
