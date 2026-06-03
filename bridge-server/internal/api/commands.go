package api

import (
	"log"
	"strings"
	"time"

	"github.com/pocketping/bridge-server/internal/types"
)

// operatorCommand is a parsed operator command typed into a bridge thread
// (e.g. "!csat"). Operator commands start with "!" and are consumed by the
// relay instead of being forwarded to the visitor as a chat message.
type operatorCommand struct {
	Name string // command name without the leading "!", lower-cased (e.g. "csat")
	Args string // any trailing text after the command, trimmed
}

// parseOperatorCommand returns a parsed command when content is an operator
// command, or nil when it is an ordinary message. Commands are matched
// case-insensitively on the first whitespace-delimited token; the rest of the
// line is returned as Args.
//
// This is intentionally minimal — today only "!csat" is wired up — but it
// establishes the convention for future bridge commands.
func parseOperatorCommand(content string) *operatorCommand {
	trimmed := strings.TrimSpace(content)
	if !strings.HasPrefix(trimmed, "!") || trimmed == "!" {
		return nil
	}

	name, args, _ := strings.Cut(trimmed[1:], " ")
	if name == "" {
		return nil
	}
	return &operatorCommand{
		Name: strings.ToLower(name),
		Args: strings.TrimSpace(args),
	}
}

// handleOperatorCommand executes a parsed operator command. It returns true
// when the command was recognised and consumed (and must not be relayed to the
// visitor), or false for an unknown command, which falls through to ordinary
// message handling.
func (s *Server) handleOperatorCommand(sessionID string, cmd *operatorCommand) bool {
	switch cmd.Name {
	case "csat":
		// Ask the visitor to rate the conversation. The widget filters on its
		// own sessionId, so the broadcast only surfaces the card for this
		// session. Mirrors the SDK/SaaS `requestCsat` → `csat_request` flow.
		s.EmitEvent(&types.CsatRequestEvent{
			Type:        "csat_request",
			SessionID:   sessionID,
			RequestedAt: time.Now().UTC().Format(time.RFC3339),
		})
		log.Printf("[API] !csat requested for session %s", sessionID)
		return true
	default:
		return false
	}
}
