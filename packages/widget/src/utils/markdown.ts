/**
 * Simple markdown renderer for chat messages
 * Supports: **bold**, *italic*, _italic_, `code`, bullet lists, and line breaks
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';

  // Escape HTML to prevent XSS
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Process line by line to handle lists
  const lines = html.split('\n');
  let inList = false;
  const processedLines: string[] = [];

  for (const line of lines) {
    // Check for bullet list items: * item or - item
    const listMatch = line.match(/^[\s]*[*-]\s+(.+)$/);
    if (listMatch) {
      if (!inList) {
        processedLines.push('<ul class="pp-md-list">');
        inList = true;
      }
      processedLines.push(`<li>${processInline(listMatch[1])}</li>`);
    } else {
      if (inList) {
        processedLines.push('</ul>');
        inList = false;
      }
      processedLines.push(processInline(line));
    }
  }

  if (inList) {
    processedLines.push('</ul>');
  }

  // Join with line breaks (but not inside lists)
  html = processedLines.join('<br />');

  // Clean up extra breaks around lists
  html = html
    .replace(/<br \/><ul/g, '<ul')
    .replace(/<\/ul><br \/>/g, '</ul>')
    .replace(/<br \/><li>/g, '<li>')
    .replace(/<\/li><br \/>/g, '</li>');

  return html;
}

/**
 * Process inline markdown (bold, italic, code)
 */
function processInline(text: string): string {
  return text
    // Bold: **text** or __text__ (process first to avoid conflict with italic)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    // Italic: *text* or _text_
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>')
    // Inline code: `code`
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * Check if text contains markdown formatting
 */
export function hasMarkdown(text: string): boolean {
  if (!text) return false;
  return /(\*\*|__|[*_]|`|\n)/.test(text);
}
