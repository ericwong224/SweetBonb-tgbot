import type { UserProfileRow } from '../db/profile.js';

export type UserLanguage = 'zh-spoken' | 'zh-written' | 'en';

export const LANGUAGE_OPTIONS: Array<{ code: UserLanguage; label: string }> = [
  { code: 'zh-spoken', label: '中文（口語）' },
  { code: 'zh-written', label: '中文（書面語）' },
  { code: 'en', label: 'English' },
];

export function needsLanguageSelection(profile: UserProfileRow | null): boolean {
  return !profile?.preferred_language;
}

export function getLanguageLabel(code: UserLanguage | null | undefined): string {
  return LANGUAGE_OPTIONS.find((o) => o.code === code)?.label ?? '未設定';
}

export function parseLanguageInput(text: string): UserLanguage | null {
  const t = text.trim().toLowerCase();
  if (['zh-spoken', 'spoken', '1', '口語', '口语', '廣東話', '广东话', 'cantonese'].includes(t)) {
    return 'zh-spoken';
  }
  if (['zh-written', 'written', '2', '書面', '书面', '書面語', '书面语', '繁體', '繁体'].includes(t)) {
    return 'zh-written';
  }
  if (['en', 'english', '3', '英文', 'eng'].includes(t)) {
    return 'en';
  }
  return null;
}

export function buildLanguagePromptBlock(lang: UserLanguage): string {
  switch (lang) {
    case 'zh-spoken':
      return '##回复语言\n请用中文口语（自然、亲切、像日常对话）回复用户。';
    case 'zh-written':
      return '##回复语言\n请用中文书面语（正式、清晰、完整句子）回复用户。';
    case 'en':
      return '##回复 language\nReply to the user in English.';
  }
}

export const LANGUAGE_PICK_MESSAGE =
  '請選擇你想使用的語言 / Choose your language:\n\n' +
  '1️⃣ 中文（口語）\n' +
  '2️⃣ 中文（書面語）\n' +
  '3️⃣ English\n\n' +
  '按下面按鈕，或輸入 1 / 2 / 3。';

export function languageSavedMessage(lang: UserLanguage): string {
  switch (lang) {
    case 'zh-spoken':
      return '已設定為中文（口語）。';
    case 'zh-written':
      return '已設定為中文（書面語）。';
    case 'en':
      return 'Language set to English.';
  }
}

export function helpMessage(lang: UserLanguage | null): string {
  if (lang === 'en') {
    return (
      'SweetBonb commands:\n' +
      '/start — Start or restart\n' +
      '/help — This message\n' +
      '/language — Change reply language\n' +
      '/status — Your profile & flow stage'
    );
  }
  const formal = lang === 'zh-written';
  if (formal) {
    return (
      'SweetBonb 指令：\n' +
      '/start — 開始使用\n' +
      '/help — 顯示此說明\n' +
      '/language — 更改回覆語言\n' +
      '/status — 查看資料與流程進度'
    );
  }
  return (
    'SweetBonb 指令：\n' +
    '/start — 開始用\n' +
    '/help — 睇指令說明\n' +
    '/language — 改回覆語言\n' +
    '/status — 睇你嘅資料同進度'
  );
}
