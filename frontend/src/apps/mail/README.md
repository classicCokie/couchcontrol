# Mail

Open Mail and enter your email address, display name, and IMAP/SMTP host,
port, TLS mode, username, and password. Use an app password when required by
your provider. Saving tests authentication against both servers before replacing
saved settings. One mail account is shared by the workspace’s Mail panes.

Both implicit TLS (typically IMAP 993 / SMTP 465) and STARTTLS (typically IMAP
143 / SMTP 587) require verified server certificates. Plaintext authentication
and OAuth-only accounts are not supported. Credentials live in the local,
permission-restricted SQLite database used by the Go server; they are not encrypted
at rest. Account responses omit passwords. Blank password fields keep existing
credentials only when the corresponding host and username are unchanged.
Disconnect removes the account settings, not remote messages.

The folder sidebar lists selectable IMAP folders and can create folders, including
nested paths using your provider’s hierarchy delimiter. Messages are paginated in
batches of 50, newest IMAP sequence first. Opening a message marks it read.
Refresh retrieves folder/message changes; there is no background synchronization.
Message operations validate UIDVALIDITY and use UIDs. Moving requires the server’s
MOVE extension; unsupported servers return an error instead of falling back to
an EXPUNGE operation that could delete unrelated messages.

The composer supports To, Cc, Bcc, Unicode subjects/bodies, and plain-text email.
Comma-separated address lists are accepted. Bcc recipients are included only in
the SMTP envelope. Reply fills the recipient and subject of an empty draft.
Drafts remain in sessionStorage per Mail pane in the current browser tab, including on failure;
they are not synchronized through IMAP. Delivery uncertainty is reported without
automatically retrying. No mail is sent until Send email is pressed.

If the provider does not automatically save sent messages, configure the exact
name of an existing Sent folder to append an additional copy after SMTP accepts
the message. A failed append is reported as a warning after successful sending;
it never causes a retry of the SMTP submission.

Reading supports MIME plain text and restricted HTML formatting. Remote images,
links, styles, and active content are removed from HTML. Attachments are listed,
but download/upload is not implemented. Reading is limited to 10 MB messages and
2 MB per text part; composing requests are limited to 2 MB.

Mail uses the existing local CouchControl host/origin boundary and is intended
for the same trusted local access as Settings and Notes. API routes are under
`/api/mail/`: account (GET/PUT/DELETE), folders (GET/POST), messages and message
(GET), seen, move, and send (POST). No credentials or live account are required
for the protocol and MIME tests in `backend/mail/handler_test.go`.
