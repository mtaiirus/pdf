# PDF URL Bot

Automatically collects PDF file URLs from Next Toppers courses and stores them in this repo. Runs daily via GitHub Actions. Data is **append-only** — existing entries are never changed or deleted.

## How it works

1. `fetch_pdfs.py` fetches all courses from the batches API.
2. It walks each course's folder tree (starting at folder 0).
3. For every content item it fetches the PDF URL from the pdfurl API.
4. New URLs are appended to `data/pdf_urls.jsonl` (one JSON record per line). Duplicates are skipped.

## Setup

1. Create a new GitHub repository (e.g. named `pdf`).
2. Upload all files from this folder (including the `.github` folder) to the repo.
3. Go to the repo's **Actions** tab and enable workflows if asked.
4. Done — it runs every day at 06:00 IST. You can also run it anytime via **Actions → Daily PDF URL update → Run workflow**.

## Data format

Each line in `data/pdf_urls.jsonl`:

```json
{"course_id": "179", "content_id": "12245", "course_title": "AARAMBH 2.0 PLUS 9th BATCH 26-27", "folder_path": "Sanskrit", "title": "Linear Eq in 2 Variable Complete", "file_url": "https://...pdf", "fetched_at": "2026-10-04T00:30:00+00:00"}
```

## Run locally (optional)

```bash
python fetch_pdfs.py
```
