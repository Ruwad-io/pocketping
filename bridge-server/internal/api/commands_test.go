package api

import (
	"testing"
	"time"

	"github.com/pocketping/bridge-server/internal/bridges"
	"github.com/pocketping/bridge-server/internal/types"
)

func TestParseOperatorCommand(t *testing.T) {
	cases := []struct {
		in       string
		wantNil  bool
		wantName string
		wantArgs string
	}{
		{"!csat", false, "csat", ""},
		{"!csat please rate us", false, "csat", "please rate us"},
		{"!csat\nplease rate this chat", false, "csat", "please rate this chat"},
		{"!csat\tnow", false, "csat", "now"},
		{"  !CSAT  ", false, "csat", ""},
		{"!Csat  extra ", false, "csat", "extra"},
		{"hello there", true, "", ""},
		{"/start", true, "", ""},
		{"!", true, "", ""},
		{"", true, "", ""},
		{"  ", true, "", ""},
	}
	for _, c := range cases {
		got := parseOperatorCommand(c.in)
		if c.wantNil {
			if got != nil {
				t.Errorf("parseOperatorCommand(%q) = %+v, want nil", c.in, got)
			}
			continue
		}
		if got == nil {
			t.Errorf("parseOperatorCommand(%q) = nil, want %s/%q", c.in, c.wantName, c.wantArgs)
			continue
		}
		if got.Name != c.wantName || got.Args != c.wantArgs {
			t.Errorf("parseOperatorCommand(%q) = %s/%q, want %s/%q", c.in, got.Name, got.Args, c.wantName, c.wantArgs)
		}
	}
}

// TestRecordOperatorMessage_csatCommand verifies that a "!csat" operator
// message is consumed by the relay: it emits a csat_request SSE event for the
// session and is NOT relayed to the visitor as an operator message.
func TestRecordOperatorMessage_csatCommand(t *testing.T) {
	bridge := newMockBridge("telegram")
	server, _ := setupTestServer([]bridges.Bridge{bridge}, nil)

	eventChan := make(chan types.OutgoingEvent, 10)
	server.eventListeners.Store(eventChan, struct{}{})
	defer server.eventListeners.Delete(eventChan)

	server.RecordOperatorMessage("s1", "!csat", "Op", "telegram", nil, nil, "100")

	select {
	case ev := <-eventChan:
		req, ok := ev.(*types.CsatRequestEvent)
		if !ok {
			t.Fatalf("expected *CsatRequestEvent, got %T (%q)", ev, ev.EventType())
		}
		if req.EventType() != "csat_request" {
			t.Errorf("expected csat_request, got %q", req.EventType())
		}
		if req.SessionID != "s1" {
			t.Errorf("expected sessionId s1, got %q", req.SessionID)
		}
		if _, err := time.Parse(time.RFC3339, req.RequestedAt); err != nil {
			t.Errorf("requestedAt %q is not RFC3339: %v", req.RequestedAt, err)
		}
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for csat_request event")
	}

	// The command must not be stored or relayed as a visitor-facing message.
	if msg := server.getMessage(buildOperatorMessageID("telegram", "100")); msg != nil {
		t.Errorf("expected !csat command not to be saved as a message, got %+v", msg)
	}
}

// TestRecordOperatorMessage_unknownCommand_relayed verifies that an unknown
// "!" command is NOT swallowed — it falls through to normal message handling.
func TestRecordOperatorMessage_unknownCommand_relayed(t *testing.T) {
	bridge := newMockBridge("telegram")
	server, _ := setupTestServer([]bridges.Bridge{bridge}, nil)

	server.RecordOperatorMessage("s1", "!notacommand hi", "Op", "telegram", nil, nil, "101")

	msg := server.getMessage(buildOperatorMessageID("telegram", "101"))
	if msg == nil {
		t.Fatal("expected unknown !command to be relayed and saved as a message")
	}
	if msg.Content != "!notacommand hi" {
		t.Errorf("expected content preserved, got %q", msg.Content)
	}
}
