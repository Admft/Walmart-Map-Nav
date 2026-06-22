package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

const port = 3456
const walmartURL = "https://developer.api.walmart.com/api-proxy/service/Store-Services/Instore-Maps/v1/store"

func main() {
	exe, err := os.Executable()
	if err != nil {
		fmt.Println("Error:", err)
		waitExit()
		return
	}
	root := filepath.Dir(exe)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/stores", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"stores": listStoreIDs(filepath.Join(root, "stores"))})
	})
	mux.HandleFunc("/api/store/", handleStoreAPI(root))
	mux.Handle("/", http.FileServer(http.Dir(root)))

	url := fmt.Sprintf("http://localhost:%d/", port)
	openBrowser(url)

	fmt.Println("Walmart Map Nav running at", url)
	fmt.Println("Close this window to stop.")
	if err := http.ListenAndServe(fmt.Sprintf(":%d", port), mux); err != nil {
		fmt.Println("Server error:", err)
		waitExit()
	}
}

func handleStoreAPI(root string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/api/store/")
		id = regexp.MustCompile(`\D`).ReplaceAllString(id, "")
		if id == "" {
			writeJSON(w, map[string]any{"error": "Invalid store number"})
			return
		}

		storesDir := filepath.Join(root, "stores")
		_ = os.MkdirAll(storesDir, 0o755)
		jsonFile := filepath.Join(storesDir, id+".json")
		force := r.URL.Query().Get("force") == "1" || r.URL.Query().Get("refresh") == "1"

		if !force {
			if data, err := os.ReadFile(jsonFile); err == nil {
				var mapData any
				if err := json.Unmarshal(data, &mapData); err == nil {
					info, _ := os.Stat(jsonFile)
					writeJSON(w, map[string]any{
						"storeId":      id,
						"cached":       true,
						"downloadedAt": info.ModTime().UTC().Format(time.RFC3339),
						"mapData":      mapData,
					})
					return
				}
			}
		}

		resp, err := http.Get(walmartURL + "/" + id + "/map")
		if err != nil {
			writeJSON(w, map[string]any{"error": err.Error()})
			return
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err != nil || resp.StatusCode != http.StatusOK {
			writeJSON(w, map[string]any{"error": fmt.Sprintf("Walmart API returned %d", resp.StatusCode)})
			return
		}

		mapData, err := extractMapData(string(body))
		if err != nil {
			writeJSON(w, map[string]any{"error": err.Error()})
			return
		}

		encoded, _ := json.Marshal(mapData)
		_ = os.WriteFile(jsonFile, encoded, 0o644)
		writeJSON(w, map[string]any{
			"storeId":      id,
			"cached":       false,
			"downloadedAt": time.Now().UTC().Format(time.RFC3339),
			"mapData":      mapData,
		})
	}
}

func extractMapData(html string) (map[string]any, error) {
	marker := "window.mapData ="
	start := strings.Index(html, marker)
	if start < 0 {
		return nil, fmt.Errorf("could not find window.mapData")
	}
	jsonStart := start + len(marker)
	depth := 0
	inStr := false
	esc := false
	end := -1
	for i := jsonStart; i < len(html); i++ {
		c := html[i]
		if inStr {
			if esc {
				esc = false
			} else if c == '\\' {
				esc = true
			} else if c == '"' {
				inStr = false
			}
			continue
		}
		if c == '"' {
			inStr = true
			continue
		}
		if c == '{' {
			depth++
		} else if c == '}' {
			depth--
			if depth == 0 {
				end = i + 1
				break
			}
		}
	}
	if end < 0 {
		return nil, fmt.Errorf("could not parse mapData JSON")
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(html[jsonStart:end])), &out); err != nil {
		return nil, err
	}
	return out, nil
}

func listStoreIDs(dir string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []string{}
	}
	re := regexp.MustCompile(`^\d+\.json$`)
	var ids []string
	for _, e := range entries {
		if e.IsDir() || !re.MatchString(e.Name()) {
			continue
		}
		ids = append(ids, strings.TrimSuffix(e.Name(), ".json"))
	}
	sortStringsNumeric(ids)
	return ids
}

func sortStringsNumeric(ids []string) {
	for i := 0; i < len(ids); i++ {
		for j := i + 1; j < len(ids); j++ {
			ai, aj := 0, 0
			fmt.Sscanf(ids[i], "%d", &ai)
			fmt.Sscanf(ids[j], "%d", &aj)
			if aj < ai {
				ids[i], ids[j] = ids[j], ids[i]
			}
		}
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(v)
}

func openBrowser(url string) {
	switch runtime.GOOS {
	case "windows":
		_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	default:
		_ = exec.Command("xdg-open", url).Start()
	}
}

func waitExit() {
	fmt.Println("Press Enter to exit...")
	_, _ = fmt.Scanln()
}
