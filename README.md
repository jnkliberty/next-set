# Next Set

A private workout tracker for logging sets and seeing progress. React on the phone, SQLite on your server, and a local browser copy for offline use.

**Status: in progress.** Set logging, supersets, saved drafts, body-area filters, and Progress charts have automated Chromium and WebKit checks. A physical iPhone workout trial remains. Historical imports still require review. Dated body-weight charts are not built.

![Progress with invented Bench Press history, weekly work, and an activity calendar](progress.png)

[Phone view](progress-phone.png).

- Log weight and reps beside the previous session's sets. Resume unfinished entries and follow superset rounds.
- Filter strength and weekly work by body area. Open the recorded sets behind a chart.
- Keep favorites and inspect the reason for a suggested target.
- Save on the device before syncing. Export the records and restore a verified backup.

Screenshots and demo workouts use invented records. No personal records or paid workout programs are included.

## Run locally

Use Node **24.21.0**.

```sh
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:18081`. Create a program and add your exercises. The default database is `data/workout.sqlite`.

For a disposable demo with sample history:

```sh
npm run demo -- --dry-run
npm run demo
```

The command prints a local address. It uses a temporary database and removes it when you stop the process. It never opens the normal database.

Docker Compose also runs without another service or external network:

```sh
docker compose --dry-run up -d --build
docker compose up -d --build
```

The port binds to loopback. The named `training_data` and `training_backups` volumes retain the records. Do not remove them when updating.

## Private phone access

This is a single-user app. Put it behind a private HTTPS service, such as a private network proxy. It has no public account or sign-in system. Set `WORKOUT_APP_ORIGIN` to the exact HTTPS address. Do not expose the unauthenticated listener to the public internet.

For example, the default local setting is `WORKOUT_APP_ORIGIN=http://127.0.0.1:18081`. Keep private addresses and any integration credentials outside the source repository.

Open the app online first so the browser can save its files. Add it to the phone's Home Screen. Clearing browser storage removes unsynced records, drafts, and rest state. Synced records remain on the server.

The optional Health bridge supplies recovery guidance when configured. Logging and Progress work without it. It is not an Apple Health integration. Dated body-weight history is a separate, unfinished extension.

## Check a change

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-test.txt
.venv/bin/python -m playwright install chromium webkit
npm run build
PLAYWRIGHT_PYTHON=.venv/bin/python npm test
```

Tests use temporary databases and invented records. Linux browser setup can require `playwright install --with-deps`. The local performance test measures a four-times-slower Chromium CPU and native WebKit. Its full-history performance check remains unresolved on the shared development machine. Shared CI runners are not a physical phone test.

The GitHub workflow checks builds, domain behavior, logging, and Progress. It does not publish or deploy. Maintain one source: test a change, approve its GitHub release, then deploy that same commit privately.

## Data and estimates

The server stores SQLite; the browser stores IndexedDB. No hosted database is required. Backups on the server's own disk do not protect against losing that machine. Keep and test a copy on another device.

Estimated strength uses recorded load, reps, and effort. Unrated sets assume two reps left. Body-area views retain separate exercises; they do not invent a combined muscle-strength score. Off sessions and provisional imports remain in the records but stay out of normal strength comparisons. Imported loads remain excluded until the import-review extension supplies approval metadata.

The source export excludes the private cache/review/import tools. You can create programs and exercises in the app. The optional exercise adapter includes no third-party dataset or images.

MIT license. Dependency licenses are included in `public/dependency-licenses.txt` and served with the app. No OpenGym code, ExerciseDB media, or proprietary program text is included.
