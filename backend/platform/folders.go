package platform

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type folder struct {
	Name string `json:"name"`
	Path string `json:"path"`
}
type folderListing struct {
	Path    string   `json:"path"`
	Parent  *string  `json:"parent"`
	Home    string   `json:"home"`
	Folders []folder `json:"folders"`
}

func listFolders(path, home string) (folderListing, error) {
	if path == "" {
		path = home
	}
	if !filepath.IsAbs(path) {
		return folderListing{}, errors.New("choose an absolute folder path")
	}
	path, err := filepath.EvalSymlinks(filepath.Clean(path))
	if err != nil {
		return folderListing{}, err
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return folderListing{}, err
	}
	listing := folderListing{Path: path, Home: home, Folders: []folder{}}
	if parent := filepath.Dir(path); parent != path {
		listing.Parent = &parent
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		child := filepath.Join(path, entry.Name())
		isDir := entry.IsDir()
		if entry.Type()&os.ModeSymlink != 0 {
			if info, err := os.Stat(child); err == nil {
				isDir = info.IsDir()
			}
		}
		if isDir {
			listing.Folders = append(listing.Folders, folder{Name: entry.Name(), Path: child})
		}
	}
	sort.Slice(listing.Folders, func(i, j int) bool {
		a, b := strings.ToLower(listing.Folders[i].Name), strings.ToLower(listing.Folders[j].Name)
		if a == b {
			return listing.Folders[i].Name < listing.Folders[j].Name
		}
		return a < b
	})
	return listing, nil
}

func (h *Handler) folders(w http.ResponseWriter, r *http.Request) {
	home, err := os.UserHomeDir()
	if err != nil {
		fail(w, 500, "Could not find the home directory.")
		return
	}
	listing, err := listFolders(r.URL.Query().Get("path"), home)
	if err != nil {
		switch {
		case errors.Is(err, os.ErrPermission):
			fail(w, 403, "This folder cannot be opened with the host's current permissions.")
		case errors.Is(err, os.ErrNotExist):
			fail(w, 404, "This folder no longer exists.")
		default:
			fail(w, 400, "Could not open this folder. Choose another folder.")
		}
		return
	}
	reply(w, 200, listing)
}
