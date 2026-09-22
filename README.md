# Job Search Command Board

A mobile-friendly private job board with Google sign-in and cross-device synchronization. The public repository contains application code and public Firebase client identifiers only. Private jobs, notes, statuses, work-search entries and ADMIN reminders belong in the authenticated database, never this repository.

## Everyday use

1. Open the hosted page and sign in with the same Google account on each device.
2. On first setup only, import your latest private JSON backup. Matching imported jobs retain existing cloud notes and statuses; new jobs are added.
3. Work on either device. Wait for **Synced across your devices** before closing the page.
4. Export a private backup periodically or when sharing updates with your assistant. Keep it private.

Notes, Viewed, job statuses, ADMIN completion and reported completed activities sync. The dated TODAY and original work-search context are preserved from the imported board; the application does not independently perform job searches or determine benefit eligibility. Moving a card does not create a work-search activity.

## Sync and conflicts

Edits are kept in a per-account device draft, then committed using a Firestore transaction. Changes to different fields combine. If the same field changed differently on another device, syncing pauses and offers both versions for export and an explicit conflict decision. Reconnecting retries pending work; the Retry sync button is also available. The app never labels an unacknowledged cloud write as synced.

Google sign-in and the initial cloud read require a connection. While an already-open board is offline, edits remain on that device and can be exported. This is not an installable offline app: reloading without a network connection is not guaranteed to work. Do not clear browser storage while edits are pending.

## Privacy

Firestore stores the board at users/{uid}/boards/main. Server rules require an authenticated, verified owner whose UID matches the path; signed-out visitors and other users cannot access that board. Sign-in sessions and recovery drafts are retained by the browser, so use a trusted browser profile and sign out on shared devices. Other applications on the same GitHub Pages origin share that browser origin's security boundary.

The app contacts the configured Firebase/Google services for sign-in and synchronization. No Analytics is enabled. Firebase web configuration values identify the app; they are not administrative credentials. Never include private backups, service-account files, passwords or GitHub tokens in this repository.

## Infrastructure

The backend uses the separate job-search-command-board Firebase project on Spark. It does not use or change the inventory application's Firebase project. Google Authentication and the standard default Firestore database are used. Scheduled cloud backups and paid products are not enabled; private JSON exports provide manual recovery.

Host the app with GitHub Pages: Deploy from a branch, main, root. Relative paths support project-site hosting. Authorize the GitHub Pages domain in this Firebase project's Authentication settings. Apply the owner-only Firestore rules before use. The Firebase SDK is pinned to version 12.19.0.

Remain on Spark with no billing account for the $0 constraint. If a quota is reached, syncing may pause; retain and export device edits rather than upgrading automatically. This repository does not configure billing or provision paid services.
