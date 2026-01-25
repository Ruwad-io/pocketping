// Package bridges provides notification bridge implementations
package bridges

import (
	"github.com/pocketping/bridge-server/internal/types"
)

// EventCallback is called when a bridge receives an event to forward
type EventCallback func(event types.OutgoingEvent)

// ReplyContext provides reply metadata for bridges
type ReplyContext struct {
	BridgeIDs *types.BridgeMessageIDs
	Quote     string
}

// Bridge is the interface that all notification bridges must implement
type Bridge interface {
	// Name returns the unique name of this bridge
	Name() string

	// SetEventCallback sets the callback for outgoing events
	SetEventCallback(callback EventCallback)

	// OnNewSession is called when a new chat session starts
	OnNewSession(session *types.Session) error

	// OnVisitorMessage is called when a visitor sends a message
	// Returns bridge message IDs for edit/delete sync
	OnVisitorMessage(message *types.Message, session *types.Session, reply *ReplyContext) (*types.BridgeMessageIDs, error)

	// OnOperatorMessage is called when an operator sends a message from another bridge
	OnOperatorMessage(message *types.Message, session *types.Session, sourceBridge, operatorName string) error

	// OnTyping is called when a visitor starts/stops typing
	OnTyping(sessionID string, isTyping bool) error

	// OnMessageRead is called when messages are marked as read
	OnMessageRead(sessionID string, messageIDs []string, status types.MessageStatus) error

	// OnCustomEvent is called when a custom event is triggered
	OnCustomEvent(event *types.CustomEvent, session *types.Session) error

	// OnIdentityUpdate is called when a user's identity is updated
	OnIdentityUpdate(session *types.Session) error

	// OnAITakeover is called when AI takes over the conversation
	OnAITakeover(session *types.Session, reason string) error

	// OnVisitorMessageEdited is called when a visitor edits a message
	OnVisitorMessageEdited(sessionID, messageID, content string, bridgeIDs *types.BridgeMessageIDs) (*types.BridgeMessageIDs, error)

	// OnVisitorMessageDeleted is called when a visitor deletes a message
	OnVisitorMessageDeleted(sessionID, messageID string, bridgeIDs *types.BridgeMessageIDs) error
}

// BaseBridge provides common functionality for all bridges
type BaseBridge struct {
	name          string
	eventCallback EventCallback
}

// NewBaseBridge creates a new base bridge
func NewBaseBridge(name string) *BaseBridge {
	return &BaseBridge{name: name}
}

// Name returns the bridge name
func (b *BaseBridge) Name() string {
	return b.name
}

// SetEventCallback sets the event callback
func (b *BaseBridge) SetEventCallback(callback EventCallback) {
	b.eventCallback = callback
}

// EmitEvent emits an outgoing event
func (b *BaseBridge) EmitEvent(event types.OutgoingEvent) {
	if b.eventCallback != nil {
		b.eventCallback(event)
	}
}
