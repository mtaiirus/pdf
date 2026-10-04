#!/usr/bin/env python3
"""
Daily PDF URL collector for Next Toppers courses.

- Fetches all batches (courses) from the catalog API.
- Walks each course's folder tree (starting at folder_id=0).
- For every PDF/content item, fetches its file URL from the pdfurl API.
- Appends ONLY new entries to data/pdf_urls.jsonl (append-only:
  existing lines are never modified or deleted).
"""

import json
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

BATCHES_URL = "https://mtaiirusapi.onrender.com/api/nt/batches"
CONTENT_URL = "https://mtaiirusapi.onrender.com/api/nt/content?course_id={course_id}&folder_id={folder_id}"
PDFURL_URL = "https://nexttoppers.nextmate.site/api/course/pdfurl?content_id={content_id}&course_id={course_id}"

DATA_FILE = Path(__file__).parent / "data" / "pdf_urls.jsonl"
REQUEST_DELAY = 0.3  # seconds between API calls, be polite


def fetch_json(url, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "pdf-url-bot/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError) as e:
            print(f"  ! request failed ({attempt + 1}/{retries}): {url} -> {e}")
            time.sleep(2 * (attempt + 1))
    return None


def load_existing_keys():
    """Return set of (course_id, content_id, file_url) already stored."""
    keys = set()
    if DATA_FILE.exists():
        with DATA_FILE.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                    keys.add((str(rec.get("course_id")), str(rec.get("content_id")), rec.get("file_url")))
                except json.JSONDecodeError:
                    continue
    return keys


def get_courses():
    data = fetch_json(BATCHES_URL)
    courses = []
    if data and data.get("success"):
        for category in data.get("catalog", []):
            for batch in category.get("batches", []):
                courses.append({"id": batch.get("id"), "title": batch.get("title")})
    return courses


def walk_folder(course_id, folder_id, path, results):
    """Recursively walk folders; collect pdfurl records for content items."""
    time.sleep(REQUEST_DELAY)
    data = fetch_json(CONTENT_URL.format(course_id=course_id, folder_id=folder_id))
    if not data or not data.get("success"):
        return
    for item in data.get("data", []):
        entity_id = item.get("entity_id")
        title = item.get("title", "")
        item_path = f"{path}/{title}" if path else title
        if item.get("type") == "folder":
            walk_folder(course_id, entity_id, item_path, results)
        else:
            time.sleep(REQUEST_DELAY)
            pdf = fetch_json(PDFURL_URL.format(content_id=entity_id, course_id=course_id))
            if not pdf:
                continue
            items = pdf if isinstance(pdf, list) else [pdf]
            for entry in items:
                file_url = entry.get("file_url")
                if file_url:
                    results.append({
                        "course_id": str(course_id),
                        "content_id": str(entry.get("id", entity_id)),
                        "course_title": None,  # filled by caller
                        "folder_path": item_path,
                        "title": entry.get("title", title),
                        "file_url": file_url,
                    })


def main():
    now = datetime.now(timezone.utc).isoformat()
    existing = load_existing_keys()
    print(f"Existing records: {len(existing)}")

    courses = get_courses()
    print(f"Courses found: {len(courses)}")

    new_records = []
    for course in courses:
        cid, ctitle = course["id"], course["title"]
        print(f"Scanning course {cid}: {ctitle}")
        results = []
        walk_folder(cid, 0, "", results)
        for rec in results:
            rec["course_title"] = ctitle
            key = (rec["course_id"], rec["content_id"], rec["file_url"])
            if key not in existing:
                rec["fetched_at"] = now
                new_records.append(rec)
                existing.add(key)

    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    with DATA_FILE.open("a", encoding="utf-8") as f:  # append-only
        for rec in new_records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    print(f"New records appended: {len(new_records)}")


if __name__ == "__main__":
    main()
