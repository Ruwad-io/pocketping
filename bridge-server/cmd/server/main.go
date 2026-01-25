// Package main is the entry point for the PocketPing Bridge Server
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	pocketping "github.com/Ruwad-io/pocketping/sdk-go"
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

	// Initialize Discord Gateway if enabled
	var discordGateway *pocketping.DiscordGateway
	if cfg.Discord != nil && cfg.Discord.EnableGateway && cfg.Discord.BotToken != "" {
		log.Println("[Bridge Server] Starting Discord Gateway for real-time message receiving...")
		discordGateway = pocketping.NewDiscordGateway(pocketping.DiscordGatewayConfig{
			BotToken:  cfg.Discord.BotToken,
			ChannelID: cfg.Discord.ChannelID,
			AllowedBotIDs: cfg.TestBotIDs,
			OnOperatorMessageWithIDs: func(ctx context.Context, sessionID, content, operatorName string, attachments []pocketping.Attachment, replyToBridgeMessageID *int, bridgeMessageID string) {
				server.RecordOperatorMessage(sessionID, content, operatorName, "discord", attachments, replyToBridgeMessageID, bridgeMessageID)
			},
			OnOperatorMessageEdit: func(ctx context.Context, sessionID, bridgeMessageID, content string, editedAt time.Time) {
				server.RecordOperatorMessageEdit(sessionID, bridgeMessageID, content, "discord", editedAt)
			},
			OnOperatorMessageDelete: func(ctx context.Context, sessionID, bridgeMessageID string, deletedAt time.Time) {
				server.RecordOperatorMessageDelete(sessionID, bridgeMessageID, "discord", deletedAt)
			},
		})

		if err := discordGateway.Connect(context.Background()); err != nil {
			log.Printf("[Bridge Server] Discord Gateway connection failed: %v", err)
		} else {
			log.Println("[Bridge Server] Discord Gateway connected successfully")
		}
	}

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

	// Close Discord Gateway if running
	if discordGateway != nil {
		if err := discordGateway.Close(); err != nil {
			log.Printf("[Bridge Server] Discord Gateway close error: %v", err)
		}
	}
}
