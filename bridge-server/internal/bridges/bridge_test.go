package bridges

import (
	"testing"

	"github.com/pocketping/bridge-server/internal/types"
)

func TestNewBaseBridge(t *testing.T) {
	bridge := NewBaseBridge("test")

	if bridge.Name() != "test" {
		t.Errorf("expected name 'test', got %q", bridge.Name())
	}
}

func TestBaseBridge_SetEventCallback(t *testing.T) {
	bridge := NewBaseBridge("test")

	var receivedEvent types.OutgoingEvent
	callback := func(event types.OutgoingEvent) {
		receivedEvent = event
	}

	bridge.SetEventCallback(callback)

	// Emit an event
	event := &types.OperatorMessageEvent{
		Type:      "operator_message",
		SessionID: "session123",
		Content:   "Hello",
	}
	bridge.EmitEvent(event)

	if receivedEvent == nil {
		t.Error("expected event to be received")
	}
	if receivedEvent.EventType() != "operator_message" {
		t.Errorf("expected event type 'operator_message', got %q", receivedEvent.EventType())
	}
}

func TestBaseBridge_EmitEvent_NilCallback(t *testing.T) {
	bridge := NewBaseBridge("test")

	// Should not panic when callback is nil
	event := &types.OperatorMessageEvent{
		Type:      "operator_message",
		SessionID: "session123",
	}
	bridge.EmitEvent(event)
	// No assertion needed - just verifying no panic
}

func TestReplyContext(t *testing.T) {
	ctx := &ReplyContext{
		BridgeIDs: &types.BridgeMessageIDs{
			TelegramMessageID: 123,
			DiscordMessageID:  "discord123",
			SlackMessageTS:    "slack.ts",
		},
		Quote: "> Previous message",
	}

	if ctx.BridgeIDs.TelegramMessageID != 123 {
		t.Errorf("TelegramMessageID mismatch")
	}
	if ctx.Quote != "> Previous message" {
		t.Errorf("Quote mismatch")
	}
}

func TestBridgeInterface(t *testing.T) {
	// Verify that concrete bridges implement the Bridge interface
	// This is a compile-time check
	var _ Bridge = (*TelegramBridge)(nil)
	var _ Bridge = (*DiscordBridge)(nil)
	var _ Bridge = (*SlackBridge)(nil)
}
