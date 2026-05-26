export function splitTelegramMessage(text: string, maxLength = 4000): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt < maxLength * 0.5) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/\*(.+?)\*/gs, '$1')
    .replace(/__(.+?)__/gs, '$1')
    .replace(/_(.+?)_/gs, '$1')
    .replace(/`(.+?)`/gs, '$1')
    .replace(/^#{1,6}\s+/gm, '');
}

export function parseMatchStart(text: string): number | null {
  const match = text.trim().match(/^\/start\s+match-(\d+)$/i);
  return match ? Number(match[1]) : null;
}

export function parseMatchTargetStart(text: string): number | null {
  const match = text.trim().match(/^\/start\s+match-target-(\d+)$/i);
  return match ? Number(match[1]) : null;
}

export function normalizeMatchResult(text: string): 'match' | 'no_match' | 'unknown' {
  const trimmed = text.trim();
  if (trimmed.includes('匹配') && !trimmed.includes('不匹配')) return 'match';
  if (trimmed.includes('不匹配')) return 'no_match';
  return 'unknown';
}
