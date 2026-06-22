//go:build embed

package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

//go:embed all:pack
var embedded embed.FS

func main() {
	storeDir := userStoreDir()
	app, _ := fs.Sub(embedded, "pack")

	mux := http.NewServeMux()
	mux.HandleFunc("/api/stores", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"stores": listEmbeddedStoreIDs(app, storeDir)})
	})
	mux.HandleFunc("/api/store/", handleEmbeddedStoreAPI(app, storeDir))
	mux.Handle("/", http.FileServer(http.FS(app)))

	url := fmt.Sprintf("http://localhost:%d/", port)
	openBrowser(url)

	fmt.Println("Walmart Map Nav running at", url)
	fmt.Println("Close this window to stop.")
	if err := http.ListenAndServe(fmt.Sprintf(":%d", port), mux); err != nil {
		fmt.Println("Server error:", err)
		waitExit()
	}
}

func handleEmbeddedStoreAPI(app fs.FS, storeDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/api/store/")
		id = regexp.MustCompile(`\D`).ReplaceAllString(id, "")
		if id == "" {
			writeJSON(w, map[string]any{"error": "Invalid store number"})
			return
		}

		jsonFile := filepath.Join(storeDir, id+".json")
		force := r.URL.Query().Get("force") == "1" || r.URL.Query().Get("refresh") == "1"

		if !force {
			if data, mtime, ok := readStoreJSON(jsonFile); ok {
				writeJSON(w, map[string]any{"storeId": id, "cached": true, "downloadedAt": mtime.UTC().Format(time.RFC3339), "mapData": data})
				return
			}
			if data, ok := readEmbeddedStore(app, id); ok {
				writeJSON(w, map[string]any{"storeId": id, "cached": true, "downloadedAt": time.Unix(0, 0).UTC().Format(time.RFC3339), "mapData": data})
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

func readEmbeddedStore(app fs.FS, id string) (any, bool) {
	raw, err := fs.ReadFile(app, "stores/"+id+".json")
	if err != nil {
		return nil, false
	}
	var data any
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, false
	}
	return data, true
}

func listEmbeddedStoreIDs(app fs.FS, storeDir string) []string {
	ids := map[string]struct{}{}
	collectDiskIDs(ids, storeDir)
	entries, _ := fs.ReadDir(app, "stores")
	re := regexp.MustCompile(`^(\d+)\.json$`)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if m := re.FindStringSubmatch(e.Name()); m != nil {
			ids[m[1]] = struct{}{}
		}
	}
	var out []string
	for id := range ids {
		out = append(out, id)
	}
	sortStringsNumeric(out)
	return out
}
