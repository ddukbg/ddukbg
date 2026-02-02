# Blogging Playbook (for the Blog Agent)

This repository is a static blog built with **StyleMD**.
This playbook defines the **single, repeatable workflow** the agent must follow when writing/publishing posts.

> **Primary goal:** turn a request into a published post on GitHub Pages with screenshots.

---

## 0) Repository Facts (Do Not Guess)

- **Repo:** https://github.com/ddukbg/ddukbg
- **Theme:** `windows98`
- **Source directories**
  - Posts: `content/*.md`
  - Pages: `pages/*.md`
- **Generated output directories**
  - StyleMD output (default): `public/`
  - GitHub Pages source (actual): `docs/`
    - **Important:** GitHub Pages serves `docs/`, so `docs/` must be updated every publish.
- **Build command:** `stylemd blog build`

---

## 1) Posting Workflow (Required)

### Step 1 — Pull latest
```bash
git pull
```

### Step 2 — Create/edit the Markdown post
Create a new file in `content/` with YAML front matter.

**Front matter requirements**
- `title` (string)
- `date` (**YYYY-MM-DD** or **YYYY-MM-DD HH:MM:SS**)
- `slug` (string)

Example:
```md
---
title: "Example Post"
date: "2025-11-12 16:20:00"
slug: example-post
---

# Example Post
...
```

Notes:
- Prefer quoting `date` to avoid YAML type surprises.
- If only a date is provided (no time), time may default to a fixed value depending on parsing.

### Step 3 — Build
```bash
stylemd blog build
```

### Step 4 — Sync `public/` → `docs/` (MANDATORY)
Even if `stylemd.config.json` says `outputDir: docs`, the CLI may still build into `public/`.
So always run the sync step.

```bash
cp -r public/* docs/
```

### Step 5 — Verify output locally
Check that the new HTML exists:
```bash
ls -l public/<slug>.html
ls -l docs/<slug>.html
```
Optionally open `docs/index.html` to confirm the post is listed.

### Step 6 — Commit and push
```bash
git add content/<new-post>.md public/ docs/

git commit -m "content: add <short-post-title>"

git push
```

### Step 7 — Confirm GitHub Pages is updated
Wait ~1–3 minutes (sometimes longer). Then check:
- Post URL: `https://ddukbg.github.io/ddukbg/<slug>.html`
- Index URL: `https://ddukbg.github.io/ddukbg/`

### Step 8 — Screenshots (Desktop + Mobile)
Capture:
- Desktop viewport (e.g. 1280×800)
- Mobile viewport (e.g. 390×844)

Send both screenshots back in the same request thread.

---

## 2) Date/Time Formatting Rules

### Desired output
- Date should be **clean** (no `GMT+0900 (Korean Standard Time)` leakage).
- Index list should look like: `YYYY-MM-DD 9:00 AM` (or another time).

### Known pitfall
If the generator merges front matter data **after** computed fields, `date` can be overwritten by a raw `Date` object and render as a long string.
Fix in StyleMD: ensure `...data` is merged **before** computed `date`/`time`.

---

## 3) Safety / Constraints

- Do not leak secrets (PAT, tokens) in Slack channels.
- If push credentials are needed, use a secure mechanism (DM once, short expiry, least privilege), or server-side secrets.

---

## 4) Request Intake Template (What the user should provide)

Minimum info needed:
- Title
- Date (YYYY-MM-DD)
- Time (optional)
- Slug
- Topic + required sections
- References (optional)
- Confirm: OK to push to public repo?

---
