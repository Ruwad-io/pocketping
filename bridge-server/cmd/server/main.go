// Package main is the entry point for the PocketPing Bridge Server
package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/joho/godotenv"
	"github.com/pocketping/bridge-server/internal/api"
	"github.com/pocketping/bridge-server/internal/bridges"
	"github.com/pocketping/bridge-server/internal/config"
)

func main() {
	fmt.Println("🚀 PocketPing Bridge Server (Go) starting...")

	// Load .env file if present
	if err := godotenv.Load(); err != nil {
		// Not an error if .env doesn't exist
		log.Println("No .env file found, using environment variables")
	}

	// Load configuration
	cfg := config.Load()

	// Initialize bridges
	var bridgeList []bridges.Bridge

	if cfg.Telegram != nil {
		log.Println("[Bridge Server] Initializing Telegram bridge...")
		bridgeList = append(bridgeList, bridges.NewTelegramBridge(cfg.Telegram))
	}

	if cfg.Discord != nil {
		log.Println("[Bridge Server] Initializing Discord bridge...")
		bridgeList = append(bridgeList, bridges.NewDiscordBridge(cfg.Discord))
	}

	if cfg.Slack != nil {
		log.Println("[Bridge Server] Initializing Slack bridge...")
		bridgeList = append(bridgeList, bridges.NewSlackBridge(cfg.Slack))
	}

	if len(bridgeList) == 0 {
		fmt.Println("\n⚠️  No bridges configured! Set environment variables to enable bridges.")
		fmt.Println("\nExample .env file:")
		fmt.Println("  TELEGRAM_BOT_TOKEN=your_token")
		fmt.Println("  TELEGRAM_CHAT_ID=your_chat_id")
		fmt.Println("")
	}

	// Create API server
	server := api.NewServer(bridgeList, cfg)

	// Setup routes
	mux := http.NewServeMux()
	server.SetupRoutes(mux)

	// Start HTTP server
	addr := fmt.Sprintf(":%d", cfg.Port)

	go func() {
		log.Printf("✅ Bridge Server running on http://localhost%s", addr)
		log.Printf("   Enabled bridges: %s", strings.Join(cfg.EnabledBridges(), ", "))
		fmt.Println("\nEndpoints:")
		fmt.Println("   GET  /health              - Health check")
		fmt.Println("   POST /api/events          - Receive events from backend")
		fmt.Println("   POST /api/sessions        - New session notification")
		fmt.Println("   POST /api/messages        - Visitor message notification")
		fmt.Println("   POST /api/operator/status - Update operator status")
		fmt.Println("   POST /api/custom-events   - Custom event notification")
		fmt.Println("   GET  /api/events/stream   - SSE stream of operator events")

		if err := http.ListenAndServe(addr, mux); err != nil {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// Wait for shutdown signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	fmt.Println("\n\n🛑 Shutting down Bridge Server...")
}
