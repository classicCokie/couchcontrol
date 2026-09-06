package main

import (
	"couchcontrol/backend/platform"
	"database/sql"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

type session struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	CWD       string `json:"cwd"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
	ExitCode  *int   `json:"exitCode"`
	Cols      int    `json:"cols"`
	Rows      int    `json:"rows"`
}

func openStore(path string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	f.Close()
	if err = os.Chmod(path, 0600); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
	CREATE TABLE IF NOT EXISTS sessions (
	 id TEXT PRIMARY KEY, title TEXT NOT NULL, cwd TEXT NOT NULL,
	 status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
	 exit_code INTEGER, cols INTEGER NOT NULL, rows INTEGER NOT NULL
	);
	CREATE TABLE IF NOT EXISTS output (
	 seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
	 data BLOB NOT NULL
	);
	CREATE INDEX IF NOT EXISTS output_session ON output(session_id, seq);
	UPDATE sessions SET status='interrupted' WHERE status='running';`)
	if err != nil {
		db.Close()
		return nil, err
	}
	if err := platform.Init(db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

const sessionColumns = "id, title, cwd, status, created_at, exit_code, cols, rows"

func scanSession(row interface{ Scan(...any) error }) (s session, err error) {
	err = row.Scan(&s.ID, &s.Title, &s.CWD, &s.Status, &s.CreatedAt, &s.ExitCode, &s.Cols, &s.Rows)
	return
}
