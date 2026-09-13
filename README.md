# TimeFlow — Personal Time Tracker & To-Do List

A single-page PWA for tracking time across topics, managing tasks, and
visualizing productivity with beautiful charts.

## Features

- **Timer** — Start/stop per-topic timers or manually log time blocks
- **To-Do List** — Add, edit, check off, and delete tasks; start a timer
  directly from any task
- **Analytics Dashboard** — Bar, doughnut, and line charts with
  Today / Week / Month / Year filters
- **Cross-Device Sync** — Firebase Firestore real-time sync, *or*
  1-click JSON export/import
- **PWA** — Add to Home Screen on mobile for a native-app experience
- **Dark Mode** — Clean, modern UI with responsive mobile-first layout

---

## Quick Start (No Server Needed)

1. Open `index.html` in any modern browser.
2. Everything works immediately using **localStorage**.
3. To use on mobile, serve the folder with any static server:

```bash
# Option A — Python
python -m http.server 8000

# Option B — Node.js
npx serve .

# Option C — VS Code Live Server extension
```

4. Open `http://<your-ip>:8000` on your phone and tap
   **Add to Home Screen**.

---

## Firebase Setup (Optional — for Real-Time Cross-Device Sync)

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. **Create a new project** (disable Google Analytics if you like)
3. Click **Web** (</>) to add a web app — copy the `firebaseConfig` object
4. Go to **Firestore Database → Create Database → Start in Test Mode**
5. In TimeFlow, click the **⇅** button (top-right), paste your config JSON:

```json
{
  "apiKey": "AIza...",
  "authDomain": "your-project.firebaseapp.com",
  "projectId": "your-project-id",
  "storageBucket": "your-project.appspot.com",
  "messagingSenderId": "123456789",
  "appId": "1:123456789:web:abc123"
}
```

6. Click **Connect Firebase** — the sync dot turns green, and all data
   syncs in real-time between devices.

### Firestore Security Rules (Recommended)

Since you're the only user, lock it down after testing:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;  // Open for single-user
    }
  }
}
```

---

## JSON Export / Import (No Firebase Alternative)

1. Click the **⇅** button in the top-right corner
2. **Export** downloads a `.json` backup file
3. **Import** on another device merges the data (deduplication by ID)

---

## File Structure

```
Time Tracker/
├── index.html          Main page
├── styles.css          All styles (dark mode, responsive)
├── app.js              Application logic
├── sw.js               Service Worker (offline caching)
├── manifest.json       PWA manifest
├── icons/
│   ├── icon-192.png    App icon (192×192)
│   └── icon-512.png    App icon (512×512)
├── generate-icons.html Icon generator utility (optional)
└── README.md           This file
```

---

## Tech Stack

- **Vanilla HTML/CSS/JS** — no build step, no framework
- **Chart.js 4** — via CDN for bar, doughnut, and line charts
- **Firebase Firestore** — optional serverless backend (loaded on demand)
- **Service Worker** — offline-capable with cache-first strategy
- **CSS Grid + Flexbox** — responsive mobile-first layout
