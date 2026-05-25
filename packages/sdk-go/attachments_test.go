package pocketping

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// recordingBridge captures messages passed to OnVisitorMessage along with a
// snapshot of their attachments, in a concurrency-safe way.
type recordingBridge struct {
	BaseBridge
	mu          sync.Mutex
	messages    []Message
	attachments [][]Attachment
}

func newRecordingBridge(name string) *recordingBridge {
	return &recordingBridge{BaseBridge: BaseBridge{BridgeName: name}}
}

func (r *recordingBridge) OnVisitorMessage(ctx context.Context, message *Message, session *Session) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.messages = append(r.messages, *message)
	atts := make([]Attachment, len(message.Attachments))
	copy(atts, message.Attachments)
	r.attachments = append(r.attachments, atts)
	return nil
}

func (r *recordingBridge) lastAttachments() ([]Attachment, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.attachments) == 0 {
		return nil, false
	}
	return r.attachments[len(r.attachments)-1], true
}

// newSession creates a PocketPing instance and a session, returning both.
func newSessionFixture(t *testing.T, pp *PocketPing) string {
	t.Helper()
	ctx := context.Background()
	resp, err := pp.HandleConnect(ctx, ConnectRequest{VisitorID: "visitor-1"})
	if err != nil {
		t.Fatalf("connect failed: %v", err)
	}
	return resp.SessionID
}

// Scenario 1: Creates upload request with presigned URL.
func TestHandleUploadRequestCreatesPresignedURL(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()
	sessionID := newSessionFixture(t, pp)

	before := time.Now()
	resp, err := pp.HandleUploadRequest(ctx, UploadRequest{
		SessionID: sessionID,
		Filename:  "photo.jpg",
		MimeType:  "image/jpeg",
		Size:      1024,
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if resp.AttachmentID == "" {
		t.Fatal("expected an attachment ID")
	}
	if !contains(resp.UploadURL, resp.AttachmentID) {
		t.Errorf("expected uploadUrl %q to contain attachmentId %q", resp.UploadURL, resp.AttachmentID)
	}
	if !resp.ExpiresAt.After(before) {
		t.Errorf("expected expiresAt %v to be in the future", resp.ExpiresAt)
	}

	// The stored attachment should be pending.
	att, err := pp.storage.(StorageWithAttachments).GetAttachment(ctx, resp.AttachmentID)
	if err != nil || att == nil {
		t.Fatalf("expected stored attachment, err=%v att=%v", err, att)
	}
	if att.Status != AttachmentStatusPending {
		t.Errorf("expected status pending, got %v", att.Status)
	}
}

// Scenario 2: Marks attachment as ready after upload.
func TestHandleUploadCompleteMarksReady(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()
	sessionID := newSessionFixture(t, pp)

	resp, err := pp.HandleUploadRequest(ctx, UploadRequest{
		SessionID: sessionID,
		Filename:  "doc.pdf",
		MimeType:  "application/pdf",
		Size:      2048,
	})
	if err != nil {
		t.Fatalf("upload request failed: %v", err)
	}

	att, err := pp.HandleUploadComplete(ctx, resp.AttachmentID)
	if err != nil {
		t.Fatalf("upload complete failed: %v", err)
	}
	if att.Status != AttachmentStatusReady {
		t.Errorf("expected status ready, got %v", att.Status)
	}

	// Verify persisted.
	stored, _ := pp.storage.(StorageWithAttachments).GetAttachment(ctx, resp.AttachmentID)
	if stored.Status != AttachmentStatusReady {
		t.Errorf("expected stored status ready, got %v", stored.Status)
	}
}

// Scenario 3: Links attachments to message.
func TestHandleMessageLinksAttachments(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()
	sessionID := newSessionFixture(t, pp)

	upload, err := pp.HandleUploadRequest(ctx, UploadRequest{
		SessionID: sessionID,
		Filename:  "report.csv",
		MimeType:  "text/csv",
		Size:      512,
	})
	if err != nil {
		t.Fatalf("upload request failed: %v", err)
	}

	msg, err := pp.HandleMessage(ctx, SendMessageRequest{
		SessionID:     sessionID,
		Content:       "here is the report",
		Sender:        SenderVisitor,
		AttachmentIDs: []string{upload.AttachmentID},
	})
	if err != nil {
		t.Fatalf("handle message failed: %v", err)
	}

	att, _ := pp.storage.(StorageWithAttachments).GetAttachment(ctx, upload.AttachmentID)
	if att == nil {
		t.Fatal("expected attachment to exist")
	}
	if att.MessageID != msg.MessageID {
		t.Errorf("expected attachment.messageId=%q, got %q", msg.MessageID, att.MessageID)
	}
}

// Scenario 4: Returns attachments with message (get messages / connect).
func TestGetMessagesReturnsAttachments(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()
	sessionID := newSessionFixture(t, pp)

	upload, _ := pp.HandleUploadRequest(ctx, UploadRequest{
		SessionID: sessionID,
		Filename:  "image.png",
		MimeType:  "image/png",
		Size:      4096,
	})
	if _, err := pp.HandleMessage(ctx, SendMessageRequest{
		SessionID:     sessionID,
		Content:       "see attached",
		Sender:        SenderVisitor,
		AttachmentIDs: []string{upload.AttachmentID},
	}); err != nil {
		t.Fatalf("handle message failed: %v", err)
	}

	// Via HandleGetMessages.
	got, err := pp.HandleGetMessages(ctx, GetMessagesRequest{SessionID: sessionID})
	if err != nil {
		t.Fatalf("get messages failed: %v", err)
	}
	if len(got.Messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(got.Messages))
	}
	if len(got.Messages[0].Attachments) != 1 {
		t.Fatalf("expected 1 attachment on message, got %d", len(got.Messages[0].Attachments))
	}
	if got.Messages[0].Attachments[0].ID != upload.AttachmentID {
		t.Errorf("expected attachment id %q, got %q", upload.AttachmentID, got.Messages[0].Attachments[0].ID)
	}

	// Via HandleConnect (resume session).
	conn, err := pp.HandleConnect(ctx, ConnectRequest{VisitorID: "visitor-1", SessionID: sessionID})
	if err != nil {
		t.Fatalf("connect failed: %v", err)
	}
	if len(conn.Messages) != 1 || len(conn.Messages[0].Attachments) != 1 {
		t.Fatalf("expected connect to return message with 1 attachment, got %+v", conn.Messages)
	}
}

// Scenario 5: Rejects invalid mime types.
func TestHandleUploadRequestRejectsInvalidMime(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()
	sessionID := newSessionFixture(t, pp)

	_, err := pp.HandleUploadRequest(ctx, UploadRequest{
		SessionID: sessionID,
		Filename:  "evil.exe",
		MimeType:  "application/x-msdownload",
		Size:      1024,
	})
	if !errors.Is(err, ErrInvalidMimeType) {
		t.Errorf("expected ErrInvalidMimeType, got %v", err)
	}
}

// Scenario 6: Rejects files over size limit.
func TestHandleUploadRequestRejectsOversizeFile(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()
	sessionID := newSessionFixture(t, pp)

	_, err := pp.HandleUploadRequest(ctx, UploadRequest{
		SessionID: sessionID,
		Filename:  "huge.pdf",
		MimeType:  "application/pdf",
		Size:      DefaultMaxAttachmentSize + 1,
	})
	if !errors.Is(err, ErrFileTooLarge) {
		t.Errorf("expected ErrFileTooLarge, got %v", err)
	}

	// Zero/negative sizes are rejected too.
	if _, err := pp.HandleUploadRequest(ctx, UploadRequest{
		SessionID: sessionID,
		Filename:  "empty.pdf",
		MimeType:  "application/pdf",
		Size:      0,
	}); !errors.Is(err, ErrFileTooLarge) {
		t.Errorf("expected ErrFileTooLarge for zero size, got %v", err)
	}
}

// Scenario 7: Handles upload failure gracefully.
func TestHandleUploadFailedAndUnknownAttachment(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()
	sessionID := newSessionFixture(t, pp)

	upload, _ := pp.HandleUploadRequest(ctx, UploadRequest{
		SessionID: sessionID,
		Filename:  "broken.zip",
		MimeType:  "application/zip",
		Size:      1024,
	})

	att, err := pp.HandleUploadFailed(ctx, upload.AttachmentID)
	if err != nil {
		t.Fatalf("upload failed handler errored: %v", err)
	}
	if att.Status != AttachmentStatusFailed {
		t.Errorf("expected status failed, got %v", att.Status)
	}

	// Unknown attachment id returns nil without crashing in storage,
	// and ErrAttachmentNotFound from the handlers.
	missing, gerr := pp.storage.(StorageWithAttachments).GetAttachment(ctx, "does-not-exist")
	if gerr != nil || missing != nil {
		t.Errorf("expected (nil, nil) for unknown attachment, got (%v, %v)", missing, gerr)
	}
	if _, herr := pp.HandleUploadComplete(ctx, "does-not-exist"); !errors.Is(herr, ErrAttachmentNotFound) {
		t.Errorf("expected ErrAttachmentNotFound, got %v", herr)
	}
}

// Scenario 8: Syncs attachments to bridges.
func TestSyncsAttachmentsToBridges(t *testing.T) {
	bridge := newRecordingBridge("recorder")
	pp := New(Config{Bridges: []Bridge{bridge}})
	ctx := context.Background()
	sessionID := newSessionFixture(t, pp)

	upload, _ := pp.HandleUploadRequest(ctx, UploadRequest{
		SessionID: sessionID,
		Filename:  "screenshot.png",
		MimeType:  "image/png",
		Size:      8192,
	})

	if _, err := pp.HandleMessage(ctx, SendMessageRequest{
		SessionID:     sessionID,
		Content:       "look at this",
		Sender:        SenderVisitor,
		AttachmentIDs: []string{upload.AttachmentID},
	}); err != nil {
		t.Fatalf("handle message failed: %v", err)
	}

	// Bridge notification is async; wait for it to be recorded.
	var atts []Attachment
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if a, ok := bridge.lastAttachments(); ok {
			atts = a
			break
		}
		time.Sleep(5 * time.Millisecond)
	}

	if len(atts) != 1 {
		t.Fatalf("expected bridge to receive 1 attachment, got %d", len(atts))
	}
	if atts[0].ID != upload.AttachmentID {
		t.Errorf("expected bridge attachment id %q, got %q", upload.AttachmentID, atts[0].ID)
	}
	if atts[0].MessageID == "" {
		t.Error("expected bridge attachment to have a linked messageId")
	}
}

// Bonus: session-not-found is surfaced from HandleUploadRequest.
func TestHandleUploadRequestSessionNotFound(t *testing.T) {
	pp := New(Config{})
	ctx := context.Background()

	_, err := pp.HandleUploadRequest(ctx, UploadRequest{
		SessionID: "nope",
		Filename:  "x.png",
		MimeType:  "image/png",
		Size:      1024,
	})
	if !errors.Is(err, ErrSessionNotFound) {
		t.Errorf("expected ErrSessionNotFound, got %v", err)
	}
}

// contains is a tiny substring helper to avoid importing strings in tests.
func contains(haystack, needle string) bool {
	if needle == "" {
		return true
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
