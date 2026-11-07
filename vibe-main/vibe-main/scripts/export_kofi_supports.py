# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "bs4==0.0.2",
#     "curl-cffi>=0.7",
#     "pyperclip>=1.9",
# ]
# ///
import json
import subprocess
from curl_cffi import requests
from bs4 import BeautifulSoup
import pyperclip

URL = "https://ko-fi.com/Feed/LoadPageFeed"
BUTTON_ID = "S6S2Z9ND2"

def fetch_page(session, page: int) -> str:
    r = session.get(
        URL,
        params={"buttonId": BUTTON_ID, "pageIndex": page},
        headers={
            "accept": "text/html, */*; q=0.01",
            "x-requested-with": "XMLHttpRequest",
            "referer": "https://ko-fi.com/thewh1teagle",
        },
        impersonate="chrome",
    )
    r.raise_for_status()
    return r.text


def parse(html: str):
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for item in soup.select(".feeditem-unit"):
        out.append({
            # "id": item.get("data-feed-item-id"),
            "name": item.select_one(".feeditem-poster-name") and item.select_one(".feeditem-poster-name").text.strip(),
            "message": item.select_one(".caption-pdg") and item.select_one(".caption-pdg").text.strip(),
            "time_ago": item.select_one(".feeditem-time") and item.select_one(".feeditem-time").text.strip().lstrip("·").strip(),
        })
    return out


def copy_to_clipboard(text: str):
    pyperclip.copy(text)


def main():
    all_items = []
    with requests.Session() as session:
        page = 0
        while True:
            print(f"Fetching page {page}...")
            html = fetch_page(session, page)
            items = parse(html)
            if not items:
                print(f"No items on page {page}, stopping.")
                break
            print(f"  Found {len(items)} items")
            all_items.extend(items)
            page += 1

    output = json.dumps(all_items, ensure_ascii=False, indent=2)
    copy_to_clipboard(output)
    print(f"Copied {len(all_items)} items to clipboard!")


if __name__ == "__main__":
    main()
