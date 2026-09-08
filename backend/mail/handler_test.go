package mail

import (
	"bufio"
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http/httptest"
	"net/smtp"
	"strings"
	"testing"
	"time"

	"github.com/emersion/go-imap/client"
	message "github.com/emersion/go-message/mail"
	_ "modernc.org/sqlite"
)

func testAccount() Account {
	return Account{Email: "me@example.com", Name: "Müller", IMAP: Endpoint{"imap.example.com", 993, "tls", "me", "secret"}, SMTP: Endpoint{"smtp.example.com", 587, "starttls", "me", "secret"}}
}
func TestComposeRoundTripAndBlindRecipients(t *testing.T) {
	d := Draft{To: "Alice <alice@example.com>", Cc: "cc@example.com", Bcc: "hidden@example.com", Subject: "Hello 世界", Body: "First line\nGrüße.\n.dot line"}
	raw, recipients, err := compose(testAccount(), d)
	if err != nil {
		t.Fatal(err)
	}
	if len(recipients) != 3 || recipients[2] != "hidden@example.com" {
		t.Fatalf("recipients: %v", recipients)
	}
	if bytes.Contains(raw, []byte("hidden@example.com")) || bytes.Contains(raw, []byte("Bcc:")) {
		t.Fatal("blind recipients leaked into message")
	}
	r, err := message.CreateReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	subject, _ := r.Header.Subject()
	if subject != d.Subject {
		t.Fatalf("subject: %q", subject)
	}
	text, _, _, err := readBody(raw)
	if err != nil {
		t.Fatal(err)
	}
	if strings.ReplaceAll(text, "\r\n", "\n") != d.Body {
		t.Fatalf("body: %q", text)
	}
}
func TestComposeRejectsHeaderInjection(t *testing.T) {
	for _, d := range []Draft{{To: "a@example.com", Subject: "Hi\r\nBcc: victim@example.com", Body: "body"}, {To: "a@example.com\nBcc: b@example.com", Body: "body"}, {To: "bad address", Body: "body"}, {Body: "no recipient"}} {
		if _, _, err := compose(testAccount(), d); err == nil {
			t.Fatalf("accepted invalid draft: %#v", d)
		}
	}
}
func TestAccountValidationRequiresTLS(t *testing.T) {
	a := testAccount()
	if err := validate(a); err != nil {
		t.Fatal(err)
	}
	a.IMAP.Security = "none"
	if validate(a) == nil {
		t.Fatal("allowed plaintext authentication")
	}
	a = testAccount()
	a.SMTP.Port = 0
	if validate(a) == nil {
		t.Fatal("allowed invalid port")
	}
}
func TestMultipartMessage(t *testing.T) {
	raw := []byte("MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\nSGVsbG8=\r\n--x\r\nContent-Type: text/html\r\n\r\n<p>Hello</p>\r\n--x\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=report.pdf\r\n\r\nignored\r\n--x--\r\n")
	plain, html, files, err := readBody(raw)
	if err != nil {
		t.Fatal(err)
	}
	if plain != "Hello" || html != "<p>Hello</p>" || len(files) != 1 || files[0] != "report.pdf" {
		t.Fatalf("%q %q %v", plain, html, files)
	}
}
func TestAccountSecretsAndDisconnect(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	db.Exec("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
	data, _ := json.Marshal(testAccount())
	db.Exec("INSERT INTO settings VALUES('mail_account',?)", string(data))
	h := New(db)
	w := httptest.NewRecorder()
	h.serve(w, httptest.NewRequest("GET", "/api/mail/account", nil))
	if w.Code != 200 || strings.Contains(w.Body.String(), "secret") || strings.Contains(w.Body.String(), "password") {
		t.Fatalf("credentials exposed: %s", w.Body.String())
	}
	w = httptest.NewRecorder()
	h.serve(w, httptest.NewRequest("DELETE", "/api/mail/account", nil))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	w = httptest.NewRecorder()
	h.serve(w, httptest.NewRequest("GET", "/api/mail/account", nil))
	if !strings.Contains(w.Body.String(), `"account":null`) {
		t.Fatal(w.Body.String())
	}
}

// Exercise real IMAP command encoding against a scripted server without external accounts.
func scriptedClient(t *testing.T, capability string, respond func(string) string) *client.Client {
	t.Helper()
	local, remote := net.Pipe()
	local.SetDeadline(time.Now().Add(5 * time.Second))
	remote.SetDeadline(time.Now().Add(5 * time.Second))
	go func() {
		defer remote.Close()
		fmt.Fprintf(remote, "* PREAUTH [CAPABILITY IMAP4rev1 %s] ready\r\n", capability)
		scanner := bufio.NewScanner(remote)
		for scanner.Scan() {
			line := scanner.Text()
			tag, cmd, _ := strings.Cut(line, " ")
			response := respond(cmd)
			if response == "" {
				response = "OK done\r\n"
			}
			if strings.HasPrefix(response, "*") {
				io.WriteString(remote, response)
				fmt.Fprintf(remote, "%s OK done\r\n", tag)
			} else {
				fmt.Fprintf(remote, "%s %s", tag, response)
			}
		}
	}()
	c, err := client.New(local)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Terminate() })
	return c
}

const selectedResponse = "* 1 EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 42] valid\r\n"

func TestMoveUsesUIDAndChecksValidity(t *testing.T) {
	for _, validity := range []string{"41", "42"} {
		t.Run(validity, func(t *testing.T) {
			commands := make(chan string, 10)
			c := scriptedClient(t, "MOVE", func(cmd string) string {
				commands <- cmd
				if strings.HasPrefix(cmd, "SELECT") {
					return selectedResponse
				}
				return ""
			})
			r := httptest.NewRequest("POST", "/api/mail/move?folder=INBOX&uid=77&validity="+validity, strings.NewReader(`{"destination":"Archive"}`))
			w := httptest.NewRecorder()
			new(Handler).messages(w, r, c, "move")
			want := 200
			if validity == "41" {
				want = 409
			}
			if w.Code != want {
				t.Fatalf("%d: %s", w.Code, w.Body.String())
			}
			close(commands)
			moved := false
			for cmd := range commands {
				if strings.Contains(cmd, "MOVE") {
					moved = true
					if cmd != `UID MOVE 77 "Archive"` {
						t.Fatalf("wrong move: %s", cmd)
					}
				}
				if strings.Contains(cmd, "EXPUNGE") {
					t.Fatal("unsafe expunge")
				}
			}
			if moved != (validity == "42") {
				t.Fatalf("move=%v", moved)
			}
		})
	}
}
func TestMoveWithoutExtensionNeverExpunges(t *testing.T) {
	commands := make(chan string, 10)
	c := scriptedClient(t, "", func(cmd string) string {
		commands <- cmd
		if strings.HasPrefix(cmd, "SELECT") {
			return selectedResponse
		}
		return ""
	})
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/api/mail/move?folder=INBOX&uid=77&validity=42", strings.NewReader(`{"destination":"Archive"}`))
	new(Handler).messages(w, r, c, "move")
	if w.Code != 422 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	close(commands)
	for cmd := range commands {
		if strings.Contains(cmd, "COPY") || strings.Contains(cmd, "STORE") || strings.Contains(cmd, "EXPUNGE") {
			t.Fatalf("unsafe fallback: %s", cmd)
		}
	}
}
func TestMessagePaginationFetchesNewestPage(t *testing.T) {
	commands := make(chan string, 10)
	c := scriptedClient(t, "", func(cmd string) string {
		commands <- cmd
		if strings.HasPrefix(cmd, "EXAMINE") {
			return "* 123 EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 42] valid\r\n"
		}
		return ""
	})
	w := httptest.NewRecorder()
	new(Handler).messages(w, httptest.NewRequest("GET", "/api/mail/messages?folder=INBOX&offset=50", nil), c, "messages")
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	close(commands)
	fetched := false
	for cmd := range commands {
		if strings.HasPrefix(cmd, "FETCH") {
			fetched = true
			if !strings.HasPrefix(cmd, "FETCH 24:73 ") {
				t.Fatalf("wrong page: %s", cmd)
			}
		}
	}
	if !fetched {
		t.Fatal("no fetch")
	}
}

func TestSMTPSubmission(t *testing.T) {
	for _, mode := range []string{"success", "reject-recipient", "uncertain"} {
		t.Run(mode, func(t *testing.T) {
			local, remote := net.Pipe()
			local.SetDeadline(time.Now().Add(5 * time.Second))
			remote.SetDeadline(time.Now().Add(5 * time.Second))
			received := make(chan []string, 1)
			go func() {
				defer remote.Close()
				var commands []string
				defer func() { received <- commands }()
				fmt.Fprint(remote, "220 smtp.example.com ready\r\n")
				scanner := bufio.NewScanner(remote)
				for scanner.Scan() {
					cmd := scanner.Text()
					commands = append(commands, cmd)
					switch {
					case strings.HasPrefix(cmd, "EHLO"):
						fmt.Fprint(remote, "250 smtp.example.com\r\n")
					case strings.HasPrefix(cmd, "RCPT") && strings.Contains(cmd, "bad@example.com") && mode == "reject-recipient":
						fmt.Fprint(remote, "550 rejected\r\n")
					case cmd == "DATA":
						fmt.Fprint(remote, "354 go ahead\r\n")
						for scanner.Scan() {
							if scanner.Text() == "." {
								break
							}
							commands = append(commands, scanner.Text())
						}
						if mode == "uncertain" {
							return
						}
						fmt.Fprint(remote, "250 queued\r\n")
					default:
						fmt.Fprint(remote, "250 OK\r\n")
					}
				}
			}()
			c, err := smtp.NewClient(local, "smtp.example.com")
			if err != nil {
				t.Fatal(err)
			}
			err = submit(c, "me@example.com", []string{"good@example.com", "bad@example.com"}, []byte("Subject: Test\r\n\r\nHello\r\n"))
			c.Close()
			commands := <-received
			all := strings.Join(commands, "\n")
			if mode == "success" && (err != nil || !strings.Contains(all, "DATA\nSubject: Test")) {
				t.Fatalf("%v: %s", err, all)
			}
			if mode == "reject-recipient" && (err == nil || strings.Contains(all, "DATA") || !strings.Contains(all, "RSET")) {
				t.Fatalf("partial send: %v %s", err, all)
			}
			if mode == "uncertain" && (err == nil || !strings.Contains(err.Error(), "could not be confirmed")) {
				t.Fatalf("missing uncertainty: %v", err)
			}
		})
	}
}
