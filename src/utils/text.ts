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

export function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

export function parseMatchStart(text: string): number | null {
  const match = text.trim().match(/^\/start\s+match-(\d+)$/i);
  return match ? Number(match[1]) : null;
}

export function normalizeMatchResult(text: string): 'match' | 'no_match' | 'unknown' {
  const trimmed = text.trim();
  if (trimmed.includes('匹配') && !trimmed.includes('不匹配')) return 'match';
  if (trimmed.includes('不匹配')) return 'no_match';
  return 'unknown';
}
