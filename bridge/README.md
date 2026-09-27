# Jamie Command Board bridge — staged, not connected

This server adds three authenticated MCP tools to the existing Firebase board:
`board_read`, `board_preview`, and `board_merge`. A separately allowlisted
read-only OAuth client sees only `board_read`, even if its token claims write
scope. That client can be used for Jumbly when its platform supports the connection.

The browser board stays on GitHub Pages and Firebase Spark. There are no Firebase
Functions, billing upgrades, scheduled searches, or private records in this change.
Vercel Hobby is the proposed separate host for this personal project; its account,
deployment, OAuth provider, ChatGPT connection and automation access still need verification.
Do not describe this draft as live or the daily refresh as connected.

## Data contract

- The server fixes the project to `job-search-command-board` and the document to
  `users/{BOARD_OWNER_UID}/boards/main`. Callers cannot choose a path or UID.
- Reads return the private board and revision. Never put that response in GitHub,
  public artifacts, shared logs or search queries.
- New jobs start as `New`, `viewed: false`, with blank user notes and Viewed date.
- Deduplication conservatively matches normalized company/role OR posting URL
  (ignoring common tracking parameters). Possible collisions are skipped for review.
- Existing jobs may receive only location, salary, posting date, link label and
  posting-verification fields, and only while `New` or `Reviewing`.
- Company, role and URL remain stable because the existing browser sync uses them
  as the identity. Notes, fit assessments, priority, lane, review status, Viewed,
  ADMIN, TODAY/PIPELINE, and work history cannot be patched by the bridge.
- Closed postings receive `postingState: closed` plus evidence; no job is deleted,
  archived or moved to another pipeline stage. The accompanying UI change shows
  these verification fields. An inaccessible page alone is `unverified`, not closed.
- Evidence dates must be today's UTC date. Prioritize postings within 14 days when
  researching; do not invent posting dates or activity. Evidence text is supplied
  by the authenticated agent, not independently verified by this server.
- Each write runs in a Firestore transaction and requires the exact revision read
  earlier. Any intervening change requires another read and preview. A retry after
  a successful write cannot silently repeat the change. No-op packets do not write.
- Limits match the browser: 3,000 jobs and a 700,000-byte saved payload. Requests
  accept at most 100 additions and 100 updates, with a 256 KB transport limit.

## Private setup sequence

1. Confirm the intended ChatGPT client offers a custom authenticated MCP connection.
   Desktop/Codex configuration alone does not prove mobile or scheduled-task access.
   Verify the scheduled task independently before changing its fallback instructions.
2. Confirm a personal Vercel Hobby account. Import this repository as a **separate**
   project, root directory `bridge`, framework Other, Node.js 22. Use this draft
   branch for testing. No paid trial or Firebase upgrade is needed by this code.
   Deployment is a separate approval step. Do not add secrets to preview deployments
   or public build logs. Keep deployment protection in place until OAuth is configured;
   MCP needs a reachable HTTPS endpoint, whose private tools remain OAuth protected.
3. Configure an established OAuth provider with MCP-compatible authorization-code
   flow, PKCE S256, exact callback allowlists, discovery and refresh support. Register
   a predefined client if supported by the ChatGPT connection dialog; otherwise use
   supported CIMD/DCR. Restrict sign-in to the owner account. The provider must mint
   RS256 or ES256 JWTs for audience `https://YOUR-BRIDGE/mcp`, include `sub`, `iat`,
   `exp`, `azp` or `client_id`, and granted `scope`. Create `board:read` and
   `board:merge` scopes. Use a distinct read-only client for Jumbly. Provider choice,
   free-plan suitability and live discovery are still setup gates, not completed work.
4. Supply the values below only in the host's private environment settings.

| Setting | Value |
|---|---|
| `BRIDGE_PUBLIC_URL` | Stable HTTPS origin, no trailing path |
| `OAUTH_ISSUER` | Exact trusted issuer, including its trailing slash if applicable |
| `OAUTH_JWKS_URL` | That provider's HTTPS signing-key endpoint |
| `OAUTH_OWNER_SUBJECT` | Owner's exact provider subject ID |
| `OAUTH_WRITE_CLIENT_IDS` | Jamie client ID(s), comma-separated |
| `OAUTH_READ_CLIENT_IDS` | Optional distinct Jumbly read-only client ID(s) |
| `BOARD_OWNER_UID` | Existing board owner's Firebase Authentication UID |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Dedicated service account JSON, private host secret only |

Prefer a workload identity / Application Default Credentials setup when the chosen
host supports it; in that case omit the JSON secret. Do not use the Firebase web
API key as an administrative credential. Never paste a service key into chat or
commit it. Use a dedicated service account with only needed Firestore IAM access;
do not use Project Owner/Editor or a broad default admin account.

**Scope distinction:** the bridge's code restricts operations to one document.
Firebase Admin SDK access bypasses Firestore Security Rules; service-account IAM is
not a per-document field firewall. The operator must review its IAM permissions.
Existing browser rules should remain owner-only. Do not grant another user access
or loosen browser rules to make this service work.

5. Deploy only once host, identity provider, permissions and secret storage are ready.
   Add `https://YOUR-BRIDGE/mcp` as the custom MCP endpoint and sign in through the
   provider's own UI. Never put an access token into a prompt.
6. Verify an unauthenticated read is denied, the wrong account is denied, and the
   read-only client cannot call merge. Read the actual private board and compare its
   count/revision with the browser. Preview a real researched metadata update, apply
   it, reload both devices, and verify notes, Viewed, ADMIN and history remain intact.
   Use real approved work for this check; do not insert synthetic jobs into production.
7. Separately verify that Daily Job Board Refresh can discover and authenticate these
   tools in a scheduled run. Until then, keep the existing Board Update Packet fallback
   and explicitly report that the live board was not updated.

## Local verification

```sh
cd bridge
npm ci --ignore-scripts
npm test
```

Tests use synthetic records, a fake transactional store, local signed JWTs and an
actual local HTTP MCP endpoint. They check preservation, deduplication, schema
rejection, revision conflicts, existing browser merge compatibility, OAuth checks,
and read-only enforcement. They do **not** verify live Firestore IAM/rules, Vercel
routing, OAuth consent, Jumbly's platform support or scheduled ChatGPT access.

The lockfile overrides gaxios 6.7.1's transitive uuid to 11.1.1 to address
GHSA-w5hq-g745-h8pq. Its only uuid use is the compatible CommonJS `v4()` export.

`npm start` binds to loopback and requires the private environment configuration.
The Vercel adapter is `api/index.mjs`. The server logs no tokens or board payloads.

## Reference documentation

- [OpenAI authenticated MCP integration](https://developers.openai.com/plugins/build/auth)
- [ChatGPT/Codex MCP configuration and client differences](https://learn.chatgpt.com/docs/extend/mcp)
- [Firebase Admin setup](https://firebase.google.com/docs/admin/setup)
- [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [Server libraries and Security Rules](https://firebase.google.com/docs/firestore/security/rules-conditions)
- [Vercel Hobby limits](https://vercel.com/docs/plans/hobby)

Live handoffs and decisions belong in Notion, not this source README.
