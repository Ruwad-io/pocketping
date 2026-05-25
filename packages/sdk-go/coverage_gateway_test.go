package pocketping

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func newTestGateway(cfg DiscordGatewayConfig) *DiscordGateway {
	g := NewDiscordGateway(cfg)
	// Provide a cancellable context so methods relying on g.ctx don't panic.
	g.ctx, g.cancel = context.WithCancel(context.Background())
	return g
}

func TestNewDiscordGateway(t *testing.T) {
	g := NewDiscordGateway(DiscordGatewayConfig{BotToken: "tok", ChannelID: "c1"})
	if g.config.BotToken != "tok" {
		t.Errorf("BotToken = %q", g.config.BotToken)
	}
	if g.httpClient == nil {
		t.Error("expected httpClient to be initialized")
	}
}

func TestGatewayGetGatewayURL(t *testing.T) {
	t.Run("from API", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bot tok" {
				t.Errorf("auth header = %q", r.Header.Get("Authorization"))
			}
			_, _ = w.Write([]byte(`{"url":"wss://gateway.discord.gg"}`))
		}))
		defer srv.Close()
		g := newTestGateway(DiscordGatewayConfig{BotToken: "tok"})
		g.httpClient = &http.Client{Transport: &discordTestTransport{baseURL: srv.URL}}
		url, err := g.getGatewayURL()
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if url != "wss://gateway.discord.gg" {
			t.Errorf("url = %q", url)
		}
	})

	t.Run("uses cached resume URL", func(t *testing.T) {
		g := newTestGateway(DiscordGatewayConfig{BotToken: "tok"})
		g.resumeURL = "wss://resume.example"
		url, err := g.getGatewayURL()
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if url != "wss://resume.example" {
			t.Errorf("url = %q, want cached resume URL", url)
		}
	})

	t.Run("decode error", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(`not json`))
		}))
		defer srv.Close()
		g := newTestGateway(DiscordGatewayConfig{BotToken: "tok"})
		g.httpClient = &http.Client{Transport: &discordTestTransport{baseURL: srv.URL}}
		if _, err := g.getGatewayURL(); err == nil {
			t.Error("expected decode error")
		}
	})
}

func TestGatewayIsAllowedBot(t *testing.T) {
	g := newTestGateway(DiscordGatewayConfig{AllowedBotIDs: []string{"B1"}})
	if !g.isAllowedBot("B1") {
		t.Error("expected B1 allowed")
	}
	if g.isAllowedBot("B2") {
		t.Error("expected B2 not allowed")
	}
	if g.isAllowedBot("") {
		t.Error("empty id should not be allowed")
	}
}

func TestGatewayDownloadFile(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte("BINARYDATA"))
		}))
		defer srv.Close()
		g := newTestGateway(DiscordGatewayConfig{})
		data, err := g.downloadFile(srv.URL + "/file.bin")
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if string(data) != "BINARYDATA" {
			t.Errorf("data = %q", string(data))
		}
	})

	t.Run("status error", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNotFound)
		}))
		defer srv.Close()
		g := newTestGateway(DiscordGatewayConfig{})
		if _, err := g.downloadFile(srv.URL); err == nil {
			t.Error("expected error on 404")
		}
	})
}

func TestGatewayHandleMessage(t *testing.T) {
	fileSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("ATT"))
	}))
	defer fileSrv.Close()

	t.Run("delivers message with attachment", func(t *testing.T) {
		var gotSession, gotContent, gotName, gotID string
		var gotAtt []Attachment
		g := newTestGateway(DiscordGatewayConfig{
			OnOperatorMessage: func(ctx context.Context, sid, c, on string, a []Attachment, r *int) {
				gotSession, gotContent, gotName, gotAtt = sid, c, on, a
			},
			OnOperatorMessageWithIDs: func(ctx context.Context, sid, c, on string, a []Attachment, r *int, bid string) {
				gotID = bid
			},
		})
		g.handleMessage(messageCreatePayload{
			ID:        "msg1",
			ChannelID: "thread1",
			Content:   "operator reply",
			Author:    discordUser{ID: "u1", Username: "Eve", Bot: false},
			Attachments: []discordAttachment{
				{Filename: "a.png", ContentType: "image/png", Size: 3, URL: fileSrv.URL + "/a.png"},
			},
		})
		if gotSession != "thread1" || gotContent != "operator reply" || gotName != "Eve" {
			t.Errorf("got session=%q content=%q name=%q", gotSession, gotContent, gotName)
		}
		if gotID != "msg1" {
			t.Errorf("bridge id = %q", gotID)
		}
		if len(gotAtt) != 1 || string(gotAtt[0].Data) != "ATT" {
			t.Errorf("attachments = %+v", gotAtt)
		}
	})

	t.Run("skips bot message", func(t *testing.T) {
		called := false
		g := newTestGateway(DiscordGatewayConfig{
			OnOperatorMessage: func(ctx context.Context, sid, c, on string, a []Attachment, r *int) { called = true },
		})
		g.handleMessage(messageCreatePayload{Author: discordUser{ID: "bot1", Bot: true}})
		if called {
			t.Error("bot message should be skipped")
		}
	})

	t.Run("allowed bot processed", func(t *testing.T) {
		called := false
		g := newTestGateway(DiscordGatewayConfig{
			AllowedBotIDs:     []string{"bot1"},
			OnOperatorMessage: func(ctx context.Context, sid, c, on string, a []Attachment, r *int) { called = true },
		})
		g.handleMessage(messageCreatePayload{ChannelID: "t", Content: "x", Author: discordUser{ID: "bot1", Bot: true}})
		if !called {
			t.Error("allowed bot should be processed")
		}
	})

	t.Run("no callbacks no-op", func(t *testing.T) {
		g := newTestGateway(DiscordGatewayConfig{})
		g.handleMessage(messageCreatePayload{ChannelID: "t", Content: "x", Author: discordUser{ID: "u1"}})
	})

	t.Run("attachment download failure skips attachment", func(t *testing.T) {
		var gotAtt []Attachment
		g := newTestGateway(DiscordGatewayConfig{
			OnOperatorMessage: func(ctx context.Context, sid, c, on string, a []Attachment, r *int) { gotAtt = a },
		})
		g.handleMessage(messageCreatePayload{
			ChannelID:   "t",
			Content:     "x",
			Author:      discordUser{ID: "u1"},
			Attachments: []discordAttachment{{URL: "http://127.0.0.1:0/bad"}},
		})
		if len(gotAtt) != 0 {
			t.Errorf("expected no attachments on download failure, got %d", len(gotAtt))
		}
	})
}

func TestGatewayHandleMessageUpdate(t *testing.T) {
	t.Run("delivers edit with parsed timestamp", func(t *testing.T) {
		var gotSession, gotID, gotContent string
		var gotEdited time.Time
		g := newTestGateway(DiscordGatewayConfig{
			OnOperatorMessageEdit: func(ctx context.Context, sid, bid, c string, e time.Time) {
				gotSession, gotID, gotContent, gotEdited = sid, bid, c, e
			},
		})
		ts := "2026-01-01T00:00:00Z"
		g.handleMessageUpdate(messageUpdatePayload{ID: "m1", ChannelID: "t1", Content: "edited", EditedTimestamp: ts})
		if gotSession != "t1" || gotID != "m1" || gotContent != "edited" {
			t.Errorf("got session=%q id=%q content=%q", gotSession, gotID, gotContent)
		}
		want, _ := time.Parse(time.RFC3339, ts)
		if !gotEdited.Equal(want) {
			t.Errorf("editedAt = %v, want %v", gotEdited, want)
		}
	})

	t.Run("skips bot edit", func(t *testing.T) {
		called := false
		g := newTestGateway(DiscordGatewayConfig{
			OnOperatorMessageEdit: func(ctx context.Context, sid, bid, c string, e time.Time) { called = true },
		})
		g.handleMessageUpdate(messageUpdatePayload{Content: "x", Author: &discordUser{ID: "b1", Bot: true}})
		if called {
			t.Error("bot edit should be skipped")
		}
	})

	t.Run("skips empty content", func(t *testing.T) {
		called := false
		g := newTestGateway(DiscordGatewayConfig{
			OnOperatorMessageEdit: func(ctx context.Context, sid, bid, c string, e time.Time) { called = true },
		})
		g.handleMessageUpdate(messageUpdatePayload{ChannelID: "t", Content: ""})
		if called {
			t.Error("empty content edit should be skipped")
		}
	})

	t.Run("no callback no-op", func(t *testing.T) {
		g := newTestGateway(DiscordGatewayConfig{})
		g.handleMessageUpdate(messageUpdatePayload{ChannelID: "t", Content: "x"})
	})

	t.Run("invalid timestamp falls back to now", func(t *testing.T) {
		var gotEdited time.Time
		g := newTestGateway(DiscordGatewayConfig{
			OnOperatorMessageEdit: func(ctx context.Context, sid, bid, c string, e time.Time) { gotEdited = e },
		})
		g.handleMessageUpdate(messageUpdatePayload{ChannelID: "t", Content: "x", EditedTimestamp: "not-a-time"})
		if gotEdited.IsZero() {
			t.Error("expected fallback to time.Now()")
		}
	})
}

func TestGatewayHandleMessageDelete(t *testing.T) {
	t.Run("delivers delete", func(t *testing.T) {
		var gotSession, gotID string
		g := newTestGateway(DiscordGatewayConfig{
			OnOperatorMessageDelete: func(ctx context.Context, sid, bid string, d time.Time) {
				gotSession, gotID = sid, bid
			},
		})
		g.handleMessageDelete(messageDeletePayload{ID: "m1", ChannelID: "t1"})
		if gotSession != "t1" || gotID != "m1" {
			t.Errorf("got session=%q id=%q", gotSession, gotID)
		}
	})

	t.Run("no callback no-op", func(t *testing.T) {
		g := newTestGateway(DiscordGatewayConfig{})
		g.handleMessageDelete(messageDeletePayload{ID: "m1", ChannelID: "t1"})
	})
}

func TestGatewayHandleDispatch(t *testing.T) {
	g := newTestGateway(DiscordGatewayConfig{})

	// READY sets sessionID and resumeURL.
	ready, _ := json.Marshal(readyPayload{SessionID: "sess9", ResumeGatewayURL: "wss://resume"})
	g.handleDispatch("READY", ready)
	if g.sessionID != "sess9" || g.resumeURL != "wss://resume" {
		t.Errorf("after READY: sessionID=%q resumeURL=%q", g.sessionID, g.resumeURL)
	}

	// MESSAGE_CREATE / UPDATE / DELETE with valid JSON (no callbacks => no-op but exercises parse).
	mc, _ := json.Marshal(messageCreatePayload{ChannelID: "t", Content: "hi", Author: discordUser{ID: "u"}})
	g.handleDispatch("MESSAGE_CREATE", mc)
	mu, _ := json.Marshal(messageUpdatePayload{ChannelID: "t", Content: "hi"})
	g.handleDispatch("MESSAGE_UPDATE", mu)
	md, _ := json.Marshal(messageDeletePayload{ChannelID: "t", ID: "m"})
	g.handleDispatch("MESSAGE_DELETE", md)

	// Unknown event -> ignored.
	g.handleDispatch("TYPING_START", json.RawMessage(`{}`))

	// Invalid JSON for each dispatch type exercises the error branches.
	g.handleDispatch("READY", json.RawMessage(`bad`))
	g.handleDispatch("MESSAGE_CREATE", json.RawMessage(`bad`))
	g.handleDispatch("MESSAGE_UPDATE", json.RawMessage(`bad`))
	g.handleDispatch("MESSAGE_DELETE", json.RawMessage(`bad`))
}

func TestGatewayHandlePayloadHeartbeatAck(t *testing.T) {
	g := newTestGateway(DiscordGatewayConfig{})
	g.handlePayload(gatewayPayload{Op: gatewayOpcodeHeartbeatAck})
	if g.lastHeartbeatAck.IsZero() {
		t.Error("expected lastHeartbeatAck to be set")
	}

	// HELLO with bad data exercises the parse-error branch.
	g.handlePayload(gatewayPayload{Op: gatewayOpcodeHello, D: json.RawMessage(`bad`)})

	// Heartbeat opcode triggers sendHeartbeat (conn nil -> send returns error, swallowed).
	g.handlePayload(gatewayPayload{Op: gatewayOpcodeHeartbeat})

	// Dispatch routes to handleDispatch.
	g.handlePayload(gatewayPayload{Op: gatewayOpcodeDispatch, T: "TYPING_START", D: json.RawMessage(`{}`)})
}

func TestGatewaySendNotConnected(t *testing.T) {
	g := newTestGateway(DiscordGatewayConfig{})
	if err := g.send(gatewayPayload{Op: gatewayOpcodeHeartbeat}); err == nil {
		t.Error("expected error when not connected")
	}
}

func TestGatewayIdentifyAndSendHeartbeatNoConn(t *testing.T) {
	g := newTestGateway(DiscordGatewayConfig{BotToken: "tok"})
	// These call send() which returns an error (conn nil); they swallow it.
	g.identify()
	g.sendHeartbeat()
	seq := 5
	g.sequence = &seq
	g.sendHeartbeat()
}

func TestGatewayCloseNoConn(t *testing.T) {
	g := newTestGateway(DiscordGatewayConfig{})
	if err := g.Close(); err != nil {
		t.Errorf("Close with no conn = %v", err)
	}
}
