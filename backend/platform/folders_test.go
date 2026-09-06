package platform

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestFolderListing(t *testing.T) {
	home := t.TempDir()
	for _, name := range []string{"Zoo", "apple", ".hidden"} {
		if err := os.Mkdir(filepath.Join(home, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(home, "file"), []byte("text"), 0600); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(home, "linked")); err != nil {
		t.Fatal(err)
	}
	listing, err := listFolders("", home)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, entry := range listing.Folders {
		names = append(names, entry.Name)
	}
	if !reflect.DeepEqual(names, []string{"apple", "linked", "Zoo"}) {
		t.Fatal(names)
	}
	canonical, _ := filepath.EvalSymlinks(home)
	if listing.Path != canonical || listing.Parent == nil {
		t.Fatal(listing)
	}
	linked, err := listFolders(filepath.Join(home, "linked"), home)
	expected, _ := filepath.EvalSymlinks(outside)
	if err != nil || linked.Path != expected {
		t.Fatal(linked, err)
	}
	root, err := listFolders("/", home)
	if err != nil || root.Parent != nil {
		t.Fatal(root, err)
	}
	for _, path := range []string{"relative", filepath.Join(home, "missing"), filepath.Join(home, "file")} {
		if _, err := listFolders(path, home); err == nil {
			t.Fatal("accepted invalid folder", path)
		}
	}
}

func TestFolderRouteStartsAtHomeWithoutCodexAuthentication(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	_, mux, _ := setup(t, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("GET", "http://localhost/api/folders", nil))
	var listing folderListing
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &listing) != nil {
		t.Fatal(w.Code, w.Body)
	}
	expected, _ := filepath.EvalSymlinks(home)
	if listing.Path != expected {
		t.Fatal(listing)
	}
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("GET", "http://localhost/api/folders?path=/does-not-exist-couchcontrol", nil))
	if w.Code != 404 {
		t.Fatal(w.Code, w.Body)
	}
}
