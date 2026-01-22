package pocketping

import (
	"context"
)

// Bridge is the interface for notification bridges.
// Implement this interface to add support for Telegram, Discord, Slack, etc.
type Bridge interface {
	// Name returns the unique name for this bridge.
	Name() string

	// Init is called when the bridge is added to PocketPing.
	Init(ctx context.Context, pp *PocketPing) error

	// OnNewSession is called when a new chat session is created.
	OnNewSession(ctx context.Context, session *Session) error

	// OnVisitorMessage is called when a visitor sends a message.
	OnVisitorMessage(ctx context.Context, message *Message, session *Session) error

	// OnOperatorMessage is called when an operator sends a message.
	// sourceBridge is the name of the bridge that originated the message.
	// operatorName is the optional name of the operator who sent the message.
	OnOperatorMessage(ctx context.Context, message *Message, session *Session, sourceBridge string, operatorName string) error

	// OnTyping is called when visitor starts/stops typing.
	OnTyping(ctx context.Context, sessionID string, isTyping bool) error

	// OnMessageRead is called when messages are marked as delivered/read.
	OnMessageRead(ctx context.Context, sessionID string, messageIDs []string, status MessageStatus) error

	// OnCustomEvent is called when a custom event is triggered from the widget.
	OnCustomEvent(ctx context.Context, event CustomEvent, session *Session) error

	// OnIdentityUpdate is called when a user identifies themselves via PocketPing.identify().
	OnIdentityUpdate(ctx context.Context, session *Session) error

	// Destroy is called for cleanup when the bridge is removed.
	Destroy(ctx context.Context) error
}

// BaseBridge provides a default implementation of the Bridge interface.
// Embed this in your bridge implementation to only override methods you need.
type BaseBridge struct {
	BridgeName string
}

// Name returns the bridge name.
func (b *BaseBridge) Name() string {
	return b.BridgeName
}

// Init is a no-op by default.
func (b *BaseBridge) Init(ctx context.Context, pp *PocketPing) error {
	return nil
}

// OnNewSession is a no-op by default.
func (b *BaseBridge) OnNewSession(ctx context.Context, session *Session) error {
	return nil
}

// OnVisitorMessage is a no-op by default.
func (b *BaseBridge) OnVisitorMessage(ctx context.Context, message *Message, session *Session) error {
	return nil
}

// OnOperatorMessage is a no-op by default.
func (b *BaseBridge) OnOperatorMessage(ctx context.Context, message *Message, session *Session, sourceBridge string, operatorName string) error {
	return nil
}

// OnTyping is a no-op by default.
func (b *BaseBridge) OnTyping(ctx context.Context, sessionID string, isTyping bool) error {
	return nil
}

// OnMessageRead is a no-op by default.
func (b *BaseBridge) OnMessageRead(ctx context.Context, sessionID string, messageIDs []string, status MessageStatus) error {
	return nil
}

// OnCustomEvent is a no-op by default.
func (b *BaseBridge) OnCustomEvent(ctx context.Context, event CustomEvent, session *Session) error {
	return nil
}

// OnIdentityUpdate is a no-op by default.
func (b *BaseBridge) OnIdentityUpdate(ctx context.Context, session *Session) error {
	return nil
}

// Destroy is a no-op by default.
func (b *BaseBridge) Destroy(ctx context.Context) error {
	return nil
}

// Ensure BaseBridge implements Bridge interface
var _ Bridge = (*BaseBridge)(nil)

// CompositeBridge forwards events to multiple bridges.
type CompositeBridge struct {
	bridges []Bridge
}

// NewCompositeBridge creates a new composite bridge.
func NewCompositeBridge(bridges ...Bridge) *CompositeBridge {
	return &CompositeBridge{bridges: bridges}
}

// Name returns the bridge name.
func (c *CompositeBridge) Name() string {
	return "composite"
}

// Init initializes all child bridges.
func (c *CompositeBridge) Init(ctx context.Context, pp *PocketPing) error {
	for _, bridge := range c.bridges {
		if err := bridge.Init(ctx, pp); err != nil {
			return err
		}
	}
	return nil
}

// OnNewSession notifies all child bridges.
func (c *CompositeBridge) OnNewSession(ctx context.Context, session *Session) error {
	for _, bridge := range c.bridges {
		if err := bridge.OnNewSession(ctx, session); err != nil {
			// Log but don't fail
			continue
		}
	}
	return nil
}

// OnVisitorMessage notifies all child bridges.
func (c *CompositeBridge) OnVisitorMessage(ctx context.Context, message *Message, session *Session) error {
	for _, bridge := range c.bridges {
		if err := bridge.OnVisitorMessage(ctx, message, session); err != nil {
			continue
		}
	}
	return nil
}

// OnOperatorMessage notifies all child bridges.
func (c *CompositeBridge) OnOperatorMessage(ctx context.Context, message *Message, session *Session, sourceBridge string, operatorName string) error {
	for _, bridge := range c.bridges {
		if err := bridge.OnOperatorMessage(ctx, message, session, sourceBridge, operatorName); err != nil {
			continue
		}
	}
	return nil
}

// OnTyping notifies all child bridges.
func (c *CompositeBridge) OnTyping(ctx context.Context, sessionID string, isTyping bool) error {
	for _, bridge := range c.bridges {
		if err := bridge.OnTyping(ctx, sessionID, isTyping); err != nil {
			continue
		}
	}
	return nil
}

// OnMessageRead notifies all child bridges.
func (c *CompositeBridge) OnMessageRead(ctx context.Context, sessionID string, messageIDs []string, status MessageStatus) error {
	for _, bridge := range c.bridges {
		if err := bridge.OnMessageRead(ctx, sessionID, messageIDs, status); err != nil {
			continue
		}
	}
	return nil
}

// OnCustomEvent notifies all child bridges.
func (c *CompositeBridge) OnCustomEvent(ctx context.Context, event CustomEvent, session *Session) error {
	for _, bridge := range c.bridges {
		if err := bridge.OnCustomEvent(ctx, event, session); err != nil {
			continue
		}
	}
	return nil
}

// OnIdentityUpdate notifies all child bridges.
func (c *CompositeBridge) OnIdentityUpdate(ctx context.Context, session *Session) error {
	for _, bridge := range c.bridges {
		if err := bridge.OnIdentityUpdate(ctx, session); err != nil {
			continue
		}
	}
	return nil
}

// Destroy cleans up all child bridges.
func (c *CompositeBridge) Destroy(ctx context.Context) error {
	for _, bridge := range c.bridges {
		if err := bridge.Destroy(ctx); err != nil {
			continue
		}
	}
	return nil
}

// AddBridge adds a bridge to the composite.
func (c *CompositeBridge) AddBridge(bridge Bridge) {
	c.bridges = append(c.bridges, bridge)
}

// Ensure CompositeBridge implements Bridge interface
var _ Bridge = (*CompositeBridge)(nil)
