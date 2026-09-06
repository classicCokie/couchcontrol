package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
)

type process struct {
	cmd      *exec.Cmd
	terminal *os.File
	done     chan struct{}
	stopOnce sync.Once
	attached bool
}
type manager struct {
	db          *sql.DB
	binary, cwd string
	mu          sync.Mutex
	active      map[string]*process
	closing     bool
}

func randomID() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func (m *manager) start(title, cwd, mode string, cols, rows int) (session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closing {
		return session{}, errors.New("server is shutting down")
	}
	if len(m.active) >= 4 {
		return session{}, errors.New("stop a running session before opening another (maximum 4)")
	}
	if cwd == "" {
		cwd = m.cwd
	}
	if !filepath.IsAbs(cwd) {
		return session{}, errors.New("working directory must be an absolute path on the host")
	}
	cwd, err := filepath.EvalSymlinks(cwd)
	if err != nil {
		return session{}, fmt.Errorf("working directory: %w", err)
	}
	info, err := os.Stat(cwd)
	if err != nil || !info.IsDir() {
		return session{}, errors.New("working directory must exist on the host")
	}
	if title = strings.TrimSpace(title); title == "" {
		title = filepath.Base(cwd)
	}
	if len(title) > 120 {
		return session{}, errors.New("session name is too long")
	}
	args := []string{"--no-alt-screen", "--sandbox", "workspace-write", "--ask-for-approval", "on-request"}
	if mode == "resume" {
		args = append(args, "resume")
	} else if mode != "" && mode != "new" {
		return session{}, errors.New("invalid session mode")
	}
	cmd := exec.Command(m.binary, args...)
	cmd.Dir = cwd
	// Do not pass the webshell access token into the agent's environment.
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(entry, "CODEX_WEB_") && !strings.HasPrefix(entry, "TERM=") && !strings.HasPrefix(entry, "COLORTERM=") {
			cmd.Env = append(cmd.Env, entry)
		}
	}
	cmd.Env = append(cmd.Env, "TERM=xterm-256color", "COLORTERM=truecolor")
	id := randomID()
	_, err = m.db.Exec("INSERT INTO sessions(id,title,cwd,status,cols,rows) VALUES(?,?,?,'running',?,?)", id, title, cwd, cols, rows)
	if err != nil {
		return session{}, err
	}
	terminal, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	if err != nil {
		m.db.Exec("UPDATE sessions SET status='failed' WHERE id=?", id)
		return session{}, fmt.Errorf("could not start Codex; install the CLI on this host and check CODEX_WEB_BINARY: %w", err)
	}
	p := &process{cmd: cmd, terminal: terminal, done: make(chan struct{})}
	m.active[id] = p
	go m.collect(id, p)
	return scanSession(m.db.QueryRow("SELECT "+sessionColumns+" FROM sessions WHERE id=?", id))
}

func (m *manager) collect(id string, p *process) {
	buf := make([]byte, 32*1024)
	for {
		n, err := p.terminal.Read(buf)
		if n > 0 {
			if _, storeErr := m.db.Exec("INSERT INTO output(session_id,data) VALUES(?,?)", id, buf[:n]); storeErr != nil {
				log.Printf("persist terminal output: %v", storeErr)
				syscall.Kill(-p.cmd.Process.Pid, syscall.SIGKILL)
				break
			}
		}
		if err != nil {
			break
		}
	}
	err := p.cmd.Wait()
	// A CLI exit must not leave background jobs from its PTY group running.
	syscall.Kill(-p.cmd.Process.Pid, syscall.SIGKILL)
	p.terminal.Close()
	code := p.cmd.ProcessState.ExitCode()
	status := "exited"
	if err != nil {
		status = "failed"
	}
	if _, err := m.db.Exec("UPDATE sessions SET status=?,exit_code=? WHERE id=?", status, code, id); err != nil {
		log.Printf("persist exit: %v", err)
	}
	m.mu.Lock()
	delete(m.active, id)
	close(p.done)
	m.mu.Unlock()
}

func (m *manager) input(id, data string, cols, rows int) error {
	m.mu.Lock()
	p := m.active[id]
	m.mu.Unlock()
	if p == nil {
		return errors.New("session is no longer running")
	}
	if data != "" {
		_, err := p.terminal.WriteString(data)
		return err
	}
	if !validSize(cols, rows) {
		return errors.New("invalid terminal size")
	}
	if err := pty.Setsize(p.terminal, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)}); err != nil {
		return err
	}
	_, err := m.db.Exec("UPDATE sessions SET cols=?,rows=? WHERE id=?", cols, rows, id)
	return err
}

func validSize(cols, rows int) bool { return cols >= 20 && cols <= 500 && rows >= 5 && rows <= 200 }

func terminate(p *process) {
	p.stopOnce.Do(func() {
		select {
		case <-p.done:
			return
		default:
		}
		syscall.Kill(-p.cmd.Process.Pid, syscall.SIGHUP)
		select {
		case <-p.done:
			// The CLI can exit before a child that ignores SIGHUP. Finish the
			// entire PTY process group even when the leader has already exited.
		case <-time.After(2 * time.Second):
		}
		syscall.Kill(-p.cmd.Process.Pid, syscall.SIGKILL)
		p.terminal.Close()
		<-p.done
	})
}

func (m *manager) stop(id string) {
	m.mu.Lock()
	p := m.active[id]
	m.mu.Unlock()
	if p != nil {
		terminate(p)
	}
}

func (m *manager) shutdown() {
	m.mu.Lock()
	m.closing = true
	processes := make([]*process, 0, len(m.active))
	for _, p := range m.active {
		processes = append(processes, p)
	}
	m.mu.Unlock()
	var wg sync.WaitGroup
	for _, p := range processes {
		wg.Add(1)
		go func() { defer wg.Done(); terminate(p) }()
	}
	wg.Wait()
}
