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

func userStoreDir() string {
	base, err := os.UserConfigDir()
	if err != nil {
		base = os.TempDir()
	}
	dir := filepath.Join(base, "WalmartMapNav", "stores")
	_ = os.MkdirAll(dir, 0o755)
	return dir
}

func readStoreJSON(path string) (any, time.Time, bool) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, time.Time{}, false
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, time.Time{}, false
	}
	var data any
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, time.Time{}, false
	}
	return data, info.ModTime(), true
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

func downloadStore(id, storeDir string) (map[string]any, error) {
	resp, err := http.Get(walmartURL + "/" + id + "/map")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil || resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("walmart API returned %d", resp.StatusCode)
	}
	mapData, err := extractMapData(string(body))
	if err != nil {
		return nil, err
	}
	encoded, _ := json.Marshal(mapData)
	_ = os.WriteFile(filepath.Join(storeDir, id+".json"), encoded, 0o644)
	return mapData, nil
}

const port = 3456
const walmartURL = "https://developer.api.walmart.com/api-proxy/service/Store-Services/Instore-Maps/v1/store"
