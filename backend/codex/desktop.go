package main

import (
	"crypto/subtle"
	"net/http"
)

// A desktop-owned service is private to its shell, including WebSocket upgrades.
// Ordinary web deployments retain their existing Host/Origin policy.
func desktopAuth(next http.Handler, token string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if token != "" && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CouchControl-Desktop")), []byte(token)) != 1 {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		r.Header.Del("X-CouchControl-Desktop")
		next.ServeHTTP(w, r)
	})
}
