//go:build !embed

package main

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

func main() {
	exe, err := os.Executable()
	if err != nil {
		fmt.Println("Error:", err)
		waitExit()
		return
	}
	root := filepath.Dir(exe)
	storeDir := userStoreDir()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/stores", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"stores": listFolderStoreIDs(root, storeDir)})
	})
	mux.HandleFunc("/api/store/", handleFolderStoreAPI(root, storeDir))
	mux.Handle("/", folderFileServer(root))

	url := fmt.Sprintf("http://localhost:%d/", port)
	openBrowser(url)

	fmt.Println("Walmart Map Nav running at", url)
	fmt.Println("Close this window to stop.")
	if err := http.ListenAndServe(fmt.Sprintf(":%d", port), mux); err != nil {
		fmt.Println("Server error:", err)
		waitExit()
	}
}

func folderFileServer(root string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/" {
			path = "/index.html"
		}
		file := filepath.Join(root, filepath.Clean(strings.TrimPrefix(path, "/")))
		if !strings.HasPrefix(file, root) {
			http.NotFound(w, r)
			return
		}
		if _, err := os.Stat(file); err != nil {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, file)
	})
}

func handleFolderStoreAPI(root, storeDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/api/store/")
		id = regexp.MustCompile(`\D`).ReplaceAllString(id, "")
		if id == "" {
			writeJSON(w, map[string]any{"error": "Invalid store number"})
			return
		}

		jsonFile := filepath.Join(storeDir, id+".json")
		bundled := filepath.Join(root, "stores", id+".json")
		force := r.URL.Query().Get("force") == "1" || r.URL.Query().Get("refresh") == "1"

		if !force {
			if data, mtime, ok := readStoreJSON(jsonFile); ok {
				writeJSON(w, map[string]any{"storeId": id, "cached": true, "downloadedAt": mtime.UTC().Format(time.RFC3339), "mapData": data})
				return
			}
			if data, mtime, ok := readStoreJSON(bundled); ok {
				writeJSON(w, map[string]any{"storeId": id, "cached": true, "downloadedAt": mtime.UTC().Format(time.RFC3339), "mapData": data})
				return
			}
		}

		mapData, err := downloadStore(id, storeDir)
		if err != nil {
			writeJSON(w, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, map[string]any{
			"storeId": id, "cached": false,
			"downloadedAt": time.Now().UTC().Format(time.RFC3339),
			"mapData": mapData,
		})
	}
}

func listFolderStoreIDs(root, storeDir string) []string {
	ids := map[string]struct{}{}
	collectDiskIDs(ids, storeDir)
	collectDiskIDs(ids, filepath.Join(root, "stores"))
	var out []string
	for id := range ids {
		out = append(out, id)
	}
	sortStringsNumeric(out)
	return out
}

func collectDiskIDs(ids map[string]struct{}, dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	re := regexp.MustCompile(`^(\d+)\.json$`)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if m := re.FindStringSubmatch(e.Name()); m != nil {
			ids[m[1]] = struct{}{}
		}
	}
}
