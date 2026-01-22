package pocketping

import (
	"encoding/json"
	"testing"
	"time"
)

func TestUserIdentityMarshalJSON(t *testing.T) {
	identity := UserIdentity{
		ID:    "user-123",
		Email: "test@example.com",
		Name:  "Test User",
		Extra: map[string]interface{}{
			"plan":    "premium",
			"company": "Acme Inc",
		},
	}

	data, err := json.Marshal(identity)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if result["id"] != "user-123" {
		t.Errorf("expected id=user-123, got %v", result["id"])
	}
	if result["email"] != "test@example.com" {
		t.Errorf("expected email=test@example.com, got %v", result["email"])
	}
	if result["plan"] != "premium" {
		t.Errorf("expected plan=premium, got %v", result["plan"])
	}
}

func TestUserIdentityUnmarshalJSON(t *testing.T) {
	data := []byte(`{"id":"user-456","email":"test@example.com","plan":"basic","company":"Test Corp"}`)

	var identity UserIdentity
	if err := json.Unmarshal(data, &identity); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if identity.ID != "user-456" {
		t.Errorf("expected id=user-456, got %v", identity.ID)
	}
	if identity.Email != "test@example.com" {
		t.Errorf("expected email=test@example.com, got %v", identity.Email)
	}
	if identity.Extra["plan"] != "basic" {
		t.Errorf("expected plan=basic, got %v", identity.Extra["plan"])
	}
}

func TestUserIdentityEmptyExtra(t *testing.T) {
	identity := UserIdentity{
		ID:    "user-789",
		Email: "test@example.com",
	}

	data, err := json.Marshal(identity)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if _, ok := result["plan"]; ok {
		t.Error("expected plan field to be absent")
	}
}

func TestSessionMetadataJSON(t *testing.T) {
	metadata := SessionMetadata{
		URL:        "https://example.com/page",
		Referrer:   "https://google.com",
		PageTitle:  "Test Page",
		UserAgent:  "Mozilla/5.0",
		DeviceType: "desktop",
		Browser:    "Chrome",
		OS:         "Windows",
	}

	data, err := json.Marshal(metadata)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var result SessionMetadata
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if result.URL != "https://example.com/page" {
		t.Errorf("expected url=https://example.com/page, got %v", result.URL)
	}
	if result.PageTitle != "Test Page" {
		t.Errorf("expected pageTitle=Test Page, got %v", result.PageTitle)
	}
}

func TestMessageStatusConstants(t *testing.T) {
	tests := []struct {
		status   MessageStatus
		expected string
	}{
		{MessageStatusSending, "sending"},
		{MessageStatusSent, "sent"},
		{MessageStatusDelivered, "delivered"},
		{MessageStatusRead, "read"},
	}

	for _, tt := range tests {
		if string(tt.status) != tt.expected {
			t.Errorf("expected %s, got %s", tt.expected, tt.status)
		}
	}
}

func TestSenderConstants(t *testing.T) {
	tests := []struct {
		sender   Sender
		expected string
	}{
		{SenderVisitor, "visitor"},
		{SenderOperator, "operator"},
		{SenderAI, "ai"},
	}

	for _, tt := range tests {
		if string(tt.sender) != tt.expected {
			t.Errorf("expected %s, got %s", tt.expected, tt.sender)
		}
	}
}

func TestVersionStatusConstants(t *testing.T) {
	tests := []struct {
		status   VersionStatus
		expected string
	}{
		{VersionStatusOK, "ok"},
		{VersionStatusOutdated, "outdated"},
		{VersionStatusDeprecated, "deprecated"},
		{VersionStatusUnsupported, "unsupported"},
	}

	for _, tt := range tests {
		if string(tt.status) != tt.expected {
			t.Errorf("expected %s, got %s", tt.expected, tt.status)
		}
	}
}

func TestMessageJSON(t *testing.T) {
	now := time.Now()
	delivered := now.Add(-time.Minute)

	msg := Message{
		ID:          "msg-123",
		SessionID:   "sess-456",
		Content:     "Hello, world!",
		Sender:      SenderVisitor,
		Timestamp:   now,
		Status:      MessageStatusDelivered,
		DeliveredAt: &delivered,
	}

	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if result["sessionId"] != "sess-456" {
		t.Errorf("expected sessionId=sess-456, got %v", result["sessionId"])
	}
	if result["sender"] != "visitor" {
		t.Errorf("expected sender=visitor, got %v", result["sender"])
	}
}

func TestSessionJSON(t *testing.T) {
	now := time.Now()

	session := Session{
		ID:             "sess-123",
		VisitorID:      "visitor-456",
		CreatedAt:      now,
		LastActivity:   now,
		OperatorOnline: true,
		AIActive:       false,
	}

	data, err := json.Marshal(session)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if result["visitorId"] != "visitor-456" {
		t.Errorf("expected visitorId=visitor-456, got %v", result["visitorId"])
	}
	if result["operatorOnline"] != true {
		t.Errorf("expected operatorOnline=true, got %v", result["operatorOnline"])
	}
}

func TestTrackedElementJSON(t *testing.T) {
	elem := TrackedElement{
		Selector:      ".pricing-btn",
		Event:         "click",
		Name:          "clicked_pricing",
		WidgetMessage: "Interested in our pricing?",
		Data: map[string]interface{}{
			"plan": "pro",
		},
	}

	data, err := json.Marshal(elem)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if result["selector"] != ".pricing-btn" {
		t.Errorf("expected selector=.pricing-btn, got %v", result["selector"])
	}
	if result["widgetMessage"] != "Interested in our pricing?" {
		t.Errorf("expected widgetMessage, got %v", result["widgetMessage"])
	}
}

func TestCustomEventJSON(t *testing.T) {
	now := time.Now()

	event := CustomEvent{
		Name:      "test_event",
		Data:      map[string]interface{}{"key": "value"},
		Timestamp: now,
		SessionID: "sess-123",
	}

	data, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if result["name"] != "test_event" {
		t.Errorf("expected name=test_event, got %v", result["name"])
	}
	if result["sessionId"] != "sess-123" {
		t.Errorf("expected sessionId=sess-123, got %v", result["sessionId"])
	}
}

func TestValidateContent(t *testing.T) {
	// Valid content
	err := ValidateContent("Hello, world!")
	if err != nil {
		t.Errorf("expected no error for valid content, got %v", err)
	}

	// Content too long
	longContent := make([]byte, MaxMessageContentLength+1)
	for i := range longContent {
		longContent[i] = 'a'
	}
	err = ValidateContent(string(longContent))
	if err != ErrContentTooLong {
		t.Errorf("expected ErrContentTooLong, got %v", err)
	}
}

func TestConnectRequestJSON(t *testing.T) {
	req := ConnectRequest{
		VisitorID: "visitor-123",
		SessionID: "session-456",
		Metadata: &SessionMetadata{
			URL: "https://example.com",
		},
	}

	data, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if result["visitorId"] != "visitor-123" {
		t.Errorf("expected visitorId=visitor-123, got %v", result["visitorId"])
	}
}

func TestConnectResponseJSON(t *testing.T) {
	resp := ConnectResponse{
		SessionID:      "sess-123",
		VisitorID:      "visitor-456",
		OperatorOnline: true,
		WelcomeMessage: "Hello!",
		Messages:       []Message{},
	}

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if result["welcomeMessage"] != "Hello!" {
		t.Errorf("expected welcomeMessage=Hello!, got %v", result["welcomeMessage"])
	}
}
