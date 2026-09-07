package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:8787", "HTTP listen address")
	dbPath := flag.String("db", "data/codex.sqlite", "SQLite database path")
	claudeDBPath := flag.String("claude-db", "", "Claude SQLite database (default: claude.sqlite beside -db)")
	cwd := flag.String("cwd", "../..", "default Codex workspace")
	staticDir := flag.String("static", "../../frontend/dist", "built frontend directory (empty disables)")
	origins := flag.String("origins", "http://127.0.0.1:8787,http://localhost:8787,http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173", "comma-separated allowed browser origins")
	flag.Parse()
	allowed, hosts, err := allowedAddresses(strings.Split(*origins, ","))
	if err != nil {
		log.Fatal(err)
	}
	workspace, err := filepath.Abs(*cwd)
	if err != nil {
		log.Fatal(err)
	}
	db, err := openStore(*dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	token := randomID()
	binary := os.Getenv("CODEX_WEB_BINARY")
	if binary == "" {
		binary = "codex"
	}
	m := &manager{db: db, binary: binary, cwd: workspace, active: map[string]*process{}}
	if *claudeDBPath == "" {
		*claudeDBPath = filepath.Join(filepath.Dir(*dbPath), "claude.sqlite")
	}
	codexPath, _ := filepath.Abs(*dbPath)
	claudePath, err := filepath.Abs(*claudeDBPath)
	if err != nil {
		log.Fatal(err)
	}
	codexInfo, codexErr := os.Stat(codexPath)
	claudeInfo, claudeErr := os.Stat(claudePath)
	if codexPath == claudePath || (codexErr == nil && claudeErr == nil && os.SameFile(codexInfo, claudeInfo)) {
		log.Fatal("Codex and Claude must use separate databases")
	}
	claudeDB, err := openStore(claudePath)
	if err != nil {
		log.Fatal(err)
	}
	defer claudeDB.Close()
	claudeBinary := os.Getenv("CLAUDE_WEB_BINARY")
	if claudeBinary == "" {
		claudeBinary = "claude"
	}
	cm := &manager{db: claudeDB, binary: claudeBinary, cwd: workspace, provider: "claude", active: map[string]*process{}}
	s := &server{manager: m, token: token, origins: allowed, hosts: hosts,
		claude: &server{manager: cm, provider: "claude", token: randomID(), origins: allowed, hosts: hosts}}

	httpServer := &http.Server{Addr: *listen, Handler: s.handler(*staticDir), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 * 1024}
	defer s.browser.Close()
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	failure := make(chan error, 1)
	go func() {
		log.Printf("CouchControl webshell (Codex + Claude) listening on %s (workspace %s)", *listen, workspace)
		failure <- httpServer.ListenAndServe()
	}()
	select {
	case <-ctx.Done():
	case err := <-failure:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Print(err)
		}
	}
	shutdown, stop := context.WithTimeout(context.Background(), 5*time.Second)
	defer stop()
	httpServer.Shutdown(shutdown)
	m.shutdown()
	cm.shutdown()
}
