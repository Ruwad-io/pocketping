package pocketping

import (
	"context"
	"fmt"
	"time"
)

// ErrAttachmentsNotSupported is returned when the configured storage does not
// implement StorageWithAttachments.
var ErrAttachmentsNotSupported = fmt.Errorf("storage does not support attachments")

// attachmentStorage returns the storage as StorageWithAttachments or an error.
func (pp *PocketPing) attachmentStorage() (StorageWithAttachments, error) {
	store, ok := pp.storage.(StorageWithAttachments)
	if !ok {
		return nil, ErrAttachmentsNotSupported
	}
	return store, nil
}

// isMimeTypeAllowed reports whether the given MIME type is in the allow list.
func (pp *PocketPing) isMimeTypeAllowed(mimeType string) bool {
	_, ok := pp.allowedMimeTypes[mimeType]
	return ok
}

// HandleUploadRequest validates an upload request and creates a pending
// attachment with a presigned upload URL.
//
// Validation order:
//  1. Session must exist (ErrSessionNotFound).
//  2. MIME type must be in the allow list (ErrInvalidMimeType).
//  3. Size must be > 0 and <= max attachment size (ErrFileTooLarge).
func (pp *PocketPing) HandleUploadRequest(ctx context.Context, request UploadRequest) (*UploadResponse, error) {
	store, err := pp.attachmentStorage()
	if err != nil {
		return nil, err
	}

	session, err := pp.storage.GetSession(ctx, request.SessionID)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, ErrSessionNotFound
	}

	if !pp.isMimeTypeAllowed(request.MimeType) {
		return nil, ErrInvalidMimeType
	}

	if request.Size <= 0 || request.Size > pp.maxAttachmentSize {
		return nil, ErrFileTooLarge
	}

	now := time.Now()
	id := pp.generateID()
	url := fmt.Sprintf("%s/%s", pp.uploadBaseURL, id)

	attachment := &Attachment{
		ID:           id,
		Filename:     request.Filename,
		MimeType:     request.MimeType,
		Size:         request.Size,
		URL:          url,
		Status:       AttachmentStatusPending,
		UploadedFrom: UploadSourceWidget,
		CreatedAt:    now,
	}

	if err := store.SaveAttachment(ctx, attachment); err != nil {
		return nil, err
	}

	return &UploadResponse{
		AttachmentID: id,
		UploadURL:    url,
		ExpiresAt:    now.Add(UploadURLTTLSeconds * time.Second),
	}, nil
}

// HandleUploadComplete marks an attachment as ready after the upload finishes.
// Returns ErrAttachmentNotFound when the attachment does not exist.
func (pp *PocketPing) HandleUploadComplete(ctx context.Context, attachmentID string) (*Attachment, error) {
	store, err := pp.attachmentStorage()
	if err != nil {
		return nil, err
	}

	attachment, err := store.GetAttachment(ctx, attachmentID)
	if err != nil {
		return nil, err
	}
	if attachment == nil {
		return nil, ErrAttachmentNotFound
	}

	attachment.Status = AttachmentStatusReady
	if err := store.UpdateAttachment(ctx, attachment); err != nil {
		return nil, err
	}

	return attachment, nil
}

// HandleUploadFailed marks an attachment as failed.
// Returns ErrAttachmentNotFound when the attachment does not exist.
func (pp *PocketPing) HandleUploadFailed(ctx context.Context, attachmentID string) (*Attachment, error) {
	store, err := pp.attachmentStorage()
	if err != nil {
		return nil, err
	}

	attachment, err := store.GetAttachment(ctx, attachmentID)
	if err != nil {
		return nil, err
	}
	if attachment == nil {
		return nil, ErrAttachmentNotFound
	}

	attachment.Status = AttachmentStatusFailed
	if err := store.UpdateAttachment(ctx, attachment); err != nil {
		return nil, err
	}

	return attachment, nil
}

// linkAttachments links the given attachment IDs to a message and returns the
// collected attachments. Unknown IDs are skipped.
func (pp *PocketPing) linkAttachments(ctx context.Context, messageID string, attachmentIDs []string) ([]Attachment, error) {
	if len(attachmentIDs) == 0 {
		return nil, nil
	}

	store, ok := pp.storage.(StorageWithAttachments)
	if !ok {
		// Attachments not supported by storage; silently skip linking.
		return nil, nil
	}

	collected := make([]Attachment, 0, len(attachmentIDs))
	for _, id := range attachmentIDs {
		attachment, err := store.GetAttachment(ctx, id)
		if err != nil {
			return nil, err
		}
		if attachment == nil {
			continue
		}
		attachment.MessageID = messageID
		if err := store.UpdateAttachment(ctx, attachment); err != nil {
			return nil, err
		}
		collected = append(collected, *attachment)
	}

	return collected, nil
}

// hydrateAttachments populates each message's Attachments field from storage
// when it is empty, so reads (get messages / connect) include attachments.
func (pp *PocketPing) hydrateAttachments(ctx context.Context, messages []Message) []Message {
	store, ok := pp.storage.(StorageWithAttachments)
	if !ok {
		return messages
	}

	for i := range messages {
		if len(messages[i].Attachments) > 0 {
			continue
		}
		atts, err := store.GetMessageAttachments(ctx, messages[i].ID)
		if err != nil || len(atts) == 0 {
			continue
		}
		messages[i].Attachments = atts
	}

	return messages
}
