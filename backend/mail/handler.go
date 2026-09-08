// Package mail connects the local workspace to an IMAP/SMTP account.
package mail

import (
	"bytes"
	"crypto/rand"
	"crypto/tls"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/http"
	netmail "net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
	_ "github.com/emersion/go-message/charset"
	message "github.com/emersion/go-message/mail"
)

type Endpoint struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Security string `json:"security"`
	Username string `json:"username"`
	Password string `json:"password,omitempty"`
}
type Account struct {
	Email      string   `json:"email"`
	Name       string   `json:"name"`
	IMAP       Endpoint `json:"imap"`
	SMTP       Endpoint `json:"smtp"`
	SentFolder string   `json:"sentFolder"`
}
type Handler struct {
	db *sql.DB
	mu sync.Mutex
}

func New(db *sql.DB) *Handler { return &Handler{db: db} }
func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/mail/", h.serve)
}
func reply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, msg string) {
	reply(w, status, map[string]string{"error": msg})
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	return json.NewDecoder(http.MaxBytesReader(w, r.Body, 2*1024*1024)).Decode(v)
}
func (h *Handler) account() (Account, error) {
	var a Account
	var s string
	err := h.db.QueryRow("SELECT value FROM settings WHERE key='mail_account'").Scan(&s)
	if err != nil {
		return a, err
	}
	err = json.Unmarshal([]byte(s), &a)
	return a, err
}
func public(a Account) Account { a.IMAP.Password = ""; a.SMTP.Password = ""; return a }
func validate(a Account) error {
	address, err := netmail.ParseAddress(a.Email)
	if err != nil || address.Address != a.Email || strings.ContainsAny(a.Name, "\r\n") {
		return errors.New("Enter a valid email address and display name.")
	}
	for _, e := range []Endpoint{a.IMAP, a.SMTP} {
		if e.Host == "" || strings.ContainsAny(e.Host, " /\r\n\t") || e.Port < 1 || e.Port > 65535 || (e.Security != "tls" && e.Security != "starttls") || e.Username == "" || e.Password == "" {
			return errors.New("Complete both servers, ports, usernames, passwords, and TLS settings.")
		}
	}
	return nil
}
func connect(e Endpoint) (net.Conn, error) {
	d := &net.Dialer{Timeout: 15 * time.Second}
	addr := net.JoinHostPort(e.Host, strconv.Itoa(e.Port))
	var c net.Conn
	var err error
	if e.Security == "tls" {
		c, err = tls.DialWithDialer(d, "tcp", addr, &tls.Config{ServerName: e.Host, MinVersion: tls.VersionTLS12})
	} else {
		c, err = d.Dial("tcp", addr)
	}
	if err == nil {
		c.SetDeadline(time.Now().Add(45 * time.Second))
	}
	return c, err
}
func openIMAP(e Endpoint) (*client.Client, error) {
	conn, err := connect(e)
	if err != nil {
		return nil, err
	}
	c, err := client.New(conn)
	if err != nil {
		conn.Close()
		return nil, err
	}
	c.Timeout = 40 * time.Second
	if e.Security == "starttls" {
		err = c.StartTLS(&tls.Config{ServerName: e.Host, MinVersion: tls.VersionTLS12})
	}
	if err == nil {
		err = c.Login(e.Username, e.Password)
	}
	if err != nil {
		c.Terminate()
		return nil, err
	}
	return c, nil
}
func openSMTP(e Endpoint) (*smtp.Client, error) {
	conn, err := connect(e)
	if err != nil {
		return nil, err
	}
	c, err := smtp.NewClient(conn, e.Host)
	if err != nil {
		conn.Close()
		return nil, err
	}
	if e.Security == "starttls" {
		err = c.StartTLS(&tls.Config{ServerName: e.Host, MinVersion: tls.VersionTLS12})
	}
	if err == nil {
		err = c.Auth(smtp.PlainAuth("", e.Username, e.Password, e.Host))
	}
	if err != nil {
		c.Close()
		return nil, err
	}
	return c, nil
}
func (h *Handler) serve(w http.ResponseWriter, r *http.Request) {
	if !h.mu.TryLock() {
		fail(w, 409, "Another mail operation is running. Try again shortly.")
		return
	}
	defer h.mu.Unlock()
	path := strings.TrimPrefix(r.URL.Path, "/api/mail/")
	a, accountErr := h.account()
	if path == "account" {
		switch r.Method {
		case "GET":
			if errors.Is(accountErr, sql.ErrNoRows) {
				reply(w, 200, map[string]any{"account": nil})
				return
			}
			if accountErr != nil {
				fail(w, 500, "Could not load mail settings.")
				return
			}
			reply(w, 200, map[string]any{"account": public(a)})
		case "PUT":
			var next Account
			if decode(w, r, &next) != nil {
				fail(w, 400, "Invalid account settings.")
				return
			}
			if accountErr == nil {
				if next.IMAP.Password == "" && next.IMAP.Host == a.IMAP.Host && next.IMAP.Username == a.IMAP.Username {
					next.IMAP.Password = a.IMAP.Password
				}
				if next.SMTP.Password == "" && next.SMTP.Host == a.SMTP.Host && next.SMTP.Username == a.SMTP.Username {
					next.SMTP.Password = a.SMTP.Password
				}
			}
			if err := validate(next); err != nil {
				fail(w, 400, err.Error())
				return
			}
			c, err := openIMAP(next.IMAP)
			if err != nil {
				fail(w, 502, "IMAP connection failed. Check the server, TLS mode, and credentials.")
				return
			}
			c.Logout()
			s, err := openSMTP(next.SMTP)
			if err != nil {
				fail(w, 502, "SMTP connection failed. Check the server, TLS mode, and credentials.")
				return
			}
			s.Quit()
			data, _ := json.Marshal(next)
			if _, err = h.db.Exec("INSERT INTO settings(key,value) VALUES('mail_account',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", string(data)); err != nil {
				fail(w, 500, "Could not save the account.")
				return
			}
			reply(w, 200, map[string]any{"account": public(next)})
		case "DELETE":
			if _, err := h.db.Exec("DELETE FROM settings WHERE key='mail_account'"); err != nil {
				fail(w, 500, "Could not disconnect the account.")
				return
			}
			reply(w, 200, map[string]bool{"disconnected": true})
		default:
			fail(w, 405, "Method not allowed.")
		}
		return
	}
	if accountErr != nil {
		fail(w, 412, "Connect a mail account first.")
		return
	}
	if path == "send" && r.Method == "POST" {
		h.send(w, r, a)
		return
	}
	if !((path == "folders" && (r.Method == "GET" || r.Method == "POST")) || (path == "messages" && r.Method == "GET") || (path == "message" && r.Method == "GET") || ((path == "move" || path == "seen") && r.Method == "POST")) {
		fail(w, 404, "Mail endpoint not found.")
		return
	}
	c, err := openIMAP(a.IMAP)
	if err != nil {
		fail(w, 502, "Could not connect to IMAP. Check your account settings.")
		return
	}
	defer c.Logout()
	switch path {
	case "folders":
		if r.Method == "POST" {
			var input struct {
				Name string `json:"name"`
			}
			if decode(w, r, &input) != nil || strings.TrimSpace(input.Name) == "" || len(input.Name) > 512 {
				fail(w, 400, "Enter a folder name.")
				return
			}
			if c.Create(input.Name) != nil {
				fail(w, 502, "Could not create that folder.")
				return
			}
			reply(w, 200, map[string]bool{"created": true})
			return
		}
		type folder struct {
			Name       string `json:"name"`
			Selectable bool   `json:"selectable"`
		}
		folders := []folder{}
		ch := make(chan *imap.MailboxInfo)
		done := make(chan error, 1)
		go func() { done <- c.List("", "*", ch) }()
		for f := range ch {
			selectable := true
			for _, v := range f.Attributes {
				if v == imap.NoSelectAttr {
					selectable = false
				}
			}
			folders = append(folders, folder{f.Name, selectable})
		}
		if <-done != nil {
			fail(w, 502, "Could not list folders.")
			return
		}
		reply(w, 200, map[string]any{"folders": folders})
	case "messages", "message", "move", "seen":
		h.messages(w, r, c, path)
	}
}

type Summary struct {
	UID     uint32    `json:"uid"`
	Subject string    `json:"subject"`
	From    string    `json:"from"`
	To      string    `json:"to"`
	ReplyTo string    `json:"replyTo"`
	Date    time.Time `json:"date"`
	Seen    bool      `json:"seen"`
	Size    uint32    `json:"size"`
}

func addresses(list []*imap.Address) string {
	a := []string{}
	for _, v := range list {
		a = append(a, (&netmail.Address{Name: v.PersonalName, Address: v.MailboxName + "@" + v.HostName}).String())
	}
	return strings.Join(a, ", ")
}
func summary(m *imap.Message) Summary {
	s := Summary{UID: m.Uid, Size: m.Size}
	if e := m.Envelope; e != nil {
		s.Subject = e.Subject
		s.From = addresses(e.From)
		s.To = addresses(e.To)
		s.ReplyTo = addresses(e.ReplyTo)
		s.Date = e.Date
	}
	for _, f := range m.Flags {
		if f == imap.SeenFlag {
			s.Seen = true
		}
	}
	return s
}
func (h *Handler) messages(w http.ResponseWriter, r *http.Request, c *client.Client, path string) {
	folder := r.URL.Query().Get("folder")
	if folder == "" {
		fail(w, 400, "Choose a folder.")
		return
	}
	box, err := c.Select(folder, path != "move" && path != "seen")
	if err != nil {
		fail(w, 502, "Could not open this folder.")
		return
	}
	if path == "messages" {
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
		if offset < 0 {
			fail(w, 400, "Invalid page.")
			return
		}
		items := []Summary{}
		if uint64(offset) < uint64(box.Messages) {
			end := box.Messages - uint32(offset)
			start := uint32(1)
			if end > 50 {
				start = end - 49
			}
			set := new(imap.SeqSet)
			set.AddRange(start, end)
			ch := make(chan *imap.Message)
			done := make(chan error, 1)
			go func() {
				done <- c.Fetch(set, []imap.FetchItem{imap.FetchUid, imap.FetchEnvelope, imap.FetchFlags, imap.FetchRFC822Size}, ch)
			}()
			for m := range ch {
				items = append(items, summary(m))
			}
			if <-done != nil {
				fail(w, 502, "Could not load messages.")
				return
			}
			for i, j := 0, len(items)-1; i < j; i, j = i+1, j-1 {
				items[i], items[j] = items[j], items[i]
			}
		}
		reply(w, 200, map[string]any{"messages": items, "total": box.Messages, "uidValidity": box.UidValidity})
		return
	}
	validity, err := strconv.ParseUint(r.URL.Query().Get("validity"), 10, 32)
	if err != nil || uint32(validity) != box.UidValidity {
		fail(w, 409, "This folder changed. Refresh it before continuing.")
		return
	}
	uid, err := strconv.ParseUint(r.URL.Query().Get("uid"), 10, 32)
	if err != nil || uid == 0 {
		fail(w, 400, "Invalid message.")
		return
	}
	set := new(imap.SeqSet)
	set.AddNum(uint32(uid))
	if path == "seen" {
		if c.UidStore(set, imap.FormatFlagsOp(imap.AddFlags, true), []interface{}{imap.SeenFlag}, nil) != nil {
			fail(w, 502, "Could not mark this message as read.")
			return
		}
		reply(w, 200, map[string]bool{"seen": true})
		return
	}
	if path == "move" {
		var input struct {
			Destination string `json:"destination"`
		}
		if decode(w, r, &input) != nil || input.Destination == "" || input.Destination == folder {
			fail(w, 400, "Choose a different destination folder.")
			return
		}
		supported, err := c.Support("MOVE")
		if err != nil || !supported {
			fail(w, 422, "This server does not support safe IMAP MOVE.")
			return
		}
		if c.UidMove(set, input.Destination) != nil {
			fail(w, 502, "Move failed. Refresh the folder before trying again.")
			return
		}
		reply(w, 200, map[string]bool{"moved": true})
		return
	}
	section := &imap.BodySectionName{Peek: true}
	ch := make(chan *imap.Message)
	done := make(chan error, 1)
	// Fetch size first to bound MIME processing and reject large messages before downloading.
	go func() { done <- c.UidFetch(set, []imap.FetchItem{imap.FetchRFC822Size}, ch) }()
	var size uint32
	found := false
	for m := range ch {
		size = m.Size
		found = true
	}
	if <-done != nil {
		fail(w, 502, "Could not read this message.")
		return
	}
	if !found {
		fail(w, 404, "Message no longer exists. Refresh the folder.")
		return
	}
	if size > 10*1024*1024 {
		fail(w, 413, "This message exceeds the 10 MB reading limit.")
		return
	}
	ch = make(chan *imap.Message)
	go func() {
		done <- c.UidFetch(set, []imap.FetchItem{imap.FetchUid, imap.FetchEnvelope, imap.FetchFlags, section.FetchItem()}, ch)
	}()
	var raw []byte
	var s Summary
	for m := range ch {
		s = summary(m)
		if body := m.GetBody(section); body != nil {
			raw, _ = io.ReadAll(io.LimitReader(body, 10*1024*1024+1))
		}
	}
	if <-done != nil || len(raw) == 0 {
		fail(w, 502, "Could not read this message.")
		return
	}
	text, html, attachments, err := readBody(raw)
	if err != nil {
		fail(w, 422, "Could not decode this message.")
		return
	}
	reply(w, 200, map[string]any{"message": s, "text": text, "html": html, "attachments": attachments})
}
func readBody(raw []byte) (string, string, []string, error) {
	r, err := message.CreateReader(bytes.NewReader(raw))
	if err != nil {
		return "", "", nil, err
	}
	defer r.Close()
	var plain, html string
	attachments := []string{}
	for {
		p, err := r.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", "", nil, err
		}
		switch header := p.Header.(type) {
		case *message.AttachmentHeader:
			name, _ := header.Filename()
			attachments = append(attachments, name)
		case *message.InlineHeader:
			kind, _, _ := header.ContentType()
			data, err := io.ReadAll(io.LimitReader(p.Body, 2*1024*1024))
			if err != nil {
				return "", "", nil, err
			}
			if kind == "text/plain" {
				plain += string(data)
			} else if kind == "text/html" {
				html += string(data)
			}
		}
	}
	return plain, html, attachments, nil
}

type Draft struct {
	To      string `json:"to"`
	Cc      string `json:"cc"`
	Bcc     string `json:"bcc"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
}

func compose(a Account, d Draft) ([]byte, []string, error) {
	if strings.ContainsAny(d.Subject+d.To+d.Cc+d.Bcc, "\r\n") || strings.TrimSpace(d.Body) == "" {
		return nil, nil, errors.New("Enter a message and valid single-line headers.")
	}
	recipients := []string{}
	headers := map[string]string{}
	for _, item := range []struct{ name, value string }{{"To", d.To}, {"Cc", d.Cc}, {"Bcc", d.Bcc}} {
		if strings.TrimSpace(item.value) == "" {
			continue
		}
		list, err := netmail.ParseAddressList(item.value)
		if err != nil {
			return nil, nil, errors.New("Check the recipient email addresses.")
		}
		formatted := []string{}
		for _, v := range list {
			recipients = append(recipients, v.Address)
			formatted = append(formatted, v.String())
		}
		headers[item.name] = strings.Join(formatted, ", ")
	}
	if len(recipients) == 0 {
		return nil, nil, errors.New("Add at least one recipient.")
	}
	var b bytes.Buffer
	fmt.Fprintf(&b, "From: %s\r\n", (&netmail.Address{Name: a.Name, Address: a.Email}).String())
	for _, key := range []string{"To", "Cc"} {
		if headers[key] != "" {
			fmt.Fprintf(&b, "%s: %s\r\n", key, headers[key])
		}
	}
	id := make([]byte, 16)
	if _, err := rand.Read(id); err != nil {
		return nil, nil, err
	}
	fmt.Fprintf(&b, "Subject: %s\r\nDate: %s\r\nMessage-ID: <%s@%s>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n", mime.QEncoding.Encode("utf-8", d.Subject), time.Now().Format(time.RFC1123Z), hex.EncodeToString(id), strings.Split(a.Email, "@")[1])
	q := quotedprintable.NewWriter(&b)
	q.Write([]byte(strings.ReplaceAll(strings.ReplaceAll(d.Body, "\r\n", "\n"), "\n", "\r\n")))
	q.Close()
	return b.Bytes(), recipients, nil
}
func (h *Handler) send(w http.ResponseWriter, r *http.Request, a Account) {
	var d Draft
	if decode(w, r, &d) != nil {
		fail(w, 400, "Invalid draft.")
		return
	}
	data, recipients, err := compose(a, d)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	c, err := openSMTP(a.SMTP)
	if err != nil {
		fail(w, 502, "Could not connect to SMTP. Your draft has been kept.")
		return
	}
	defer c.Close()
	if err = submit(c, a.Email, recipients, data); err != nil {
		fail(w, 502, err.Error())
		return
	}
	warning := ""
	if a.SentFolder != "" {
		imapClient, err := openIMAP(a.IMAP)
		if err == nil {
			err = imapClient.Append(a.SentFolder, []string{imap.SeenFlag}, time.Now(), bytes.NewReader(data))
			imapClient.Logout()
		}
		if err != nil {
			warning = "Email sent, but the copy could not be saved to your Sent folder. Do not resend."
		}
	}
	reply(w, 200, map[string]any{"sent": true, "warning": warning})
}

func submit(c *smtp.Client, sender string, recipients []string, data []byte) error {
	err := c.Mail(sender)
	if err == nil {
		for _, address := range recipients {
			if err = c.Rcpt(address); err != nil {
				break
			}
		}
	}
	if err != nil {
		c.Reset()
		return errors.New("SMTP rejected the sender or a recipient. No message was sent.")
	}
	writer, err := c.Data()
	if err != nil {
		return errors.New("SMTP did not accept the message. Your draft has been kept.")
	}
	_, writeErr := writer.Write(data)
	closeErr := writer.Close()
	if writeErr != nil || closeErr != nil {
		return errors.New("Delivery could not be confirmed. Check Sent or contact your recipient before retrying to avoid duplicates.")
	}
	return nil
}
