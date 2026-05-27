import type { PostFieldDef } from '../db/post-fields.js';

export interface SavedFieldAnswer {
  fieldKey: string;
  label: string;
  value: string;
}

function spoken(lang: string | null | undefined): boolean {
  return lang !== 'en' && lang !== 'zh-written';
}

function ackValue(fieldKey: string, value: string, lang: string | null | undefined): string {
  const en = lang === 'en';
  const formal = lang === 'zh-written';
  if (fieldKey === 'target_gender') {
    return en ? `Looking for ${value}.` : formal ? `已了解，尋找對象為${value}。` : `好～你想搵${value}。`;
  }
  if (fieldKey === 'target_relationship') {
    return en ? `Relationship type: ${value}.` : formal ? `已了解，期望關係：${value}。` : `明白，你想要「${value}」呢種關係。`;
  }
  if (fieldKey === 'target_age') {
    return en ? `Target age: ${value}.` : formal ? `已了解，期望年齡：${value}。` : `好，期望年齡 ${value}。`;
  }
  if (fieldKey === 'target_height') {
    return en ? `Target height around ${value} cm.` : formal ? `已了解，期望身高：${value} cm。` : `期望身高 ${value} cm，記低咗。`;
  }
  if (fieldKey === 'target_relationship_status') {
    return en ? `Their status: ${value}.` : formal ? `已了解，期望對象感情狀況：${value}。` : `對象感情狀況「${value}」，OK。`;
  }
  if (fieldKey === 'target_bodyshape') {
    return en ? `Preferred body type: ${value}.` : formal ? `已了解，期望身形：${value}。` : `期望身形「${value}」，收到。`;
  }
  if (fieldKey === 'member_height') {
    return en ? `Your height: ${value} cm.` : formal ? `已了解，你的身高：${value} cm。` : `你身高 ${value} cm，記低咗。`;
  }
  if (fieldKey === 'member_weight') {
    return en ? `Your weight: ${value} kg.` : formal ? `已了解，你的體重：${value} kg。` : `體重 ${value} kg，收到。`;
  }
  if (fieldKey === 'member_relationship_status') {
    return en ? `Your status: ${value}.` : formal ? `已了解，你的感情狀況：${value}。` : `你而家「${value}」，明白。`;
  }
  if (fieldKey === 'member_sexual_experience') {
    return en ? `Noted.` : formal ? `已了解。` : `呢部分記低咗。`;
  }
  if (fieldKey === 'member_profile') {
    return en ? `Profile saved.` : formal ? `個人簡介已記錄。` : `簡介收到～`;
  }
  if (fieldKey === 'other_sexual_interests') {
    return en ? `Interests noted.` : formal ? `其他性趣已記錄。` : `其他性趣記低咗。`;
  }
  if (fieldKey === 'secure_pairing_options') {
    return en ? `Privacy setting: ${value}.` : formal ? `已了解，安全配對設定：${value}。` : `安全配對「${value}」，設定好。`;
  }
  if (fieldKey === 'location') {
    return en ? `Location: ${value}.` : formal ? `現居地：${value}。` : `${value}，記低咗～`;
  }
  return en ? `Noted: ${value}.` : formal ? `已記錄：${value}。` : `好，${value}～`;
}

function askChoice(field: PostFieldDef, lang: string | null | undefined): string {
  const en = lang === 'en';
  const formal = lang === 'zh-written';
  const label = field.label_zh || field.field_key;

  switch (field.field_key) {
    case 'target_gender':
      return en
        ? 'What gender are you looking for?'
        : formal
          ? '你想尋找什麼性別的對象？'
          : '你想搵咩性別嘅對象？';
    case 'target_relationship':
      return en
        ? 'What kind of relationship are you hoping for?'
        : formal
          ? '你期望的關係類型是？'
          : '咁你期望係咩關係類型？';
    case 'target_age':
      return en
        ? 'Preferred age range or minimum age (e.g. 18-20 or 20+)?'
        : formal
          ? '期望對象的年齡範圍或最低年齡（如 18-20 或 20+）？'
          : '對方大概幾多歲最啱你？（例如 18-20 或 20+）';
    case 'target_relationship_status':
      return en
        ? 'What relationship status should they have?'
        : formal
          ? '期望對象的感情狀況？'
          : '你希望對象嘅感情狀況係點？';
    case 'member_relationship_status':
      return en
        ? 'What is your current relationship status?'
        : formal
          ? '你目前的感情狀況是？'
          : '而家你嘅感情狀況係？';
    case 'secure_pairing_options':
      return en
        ? 'How should your username appear when matching?'
        : formal
          ? '配對時是否顯示你的用戶名？'
          : '配對嗰陣要唔要顯示你嘅 username？';
    default:
      return en ? `Please choose: ${label}` : formal ? `請選擇：${label}` : `請揀：${label}`;
  }
}

function askText(field: PostFieldDef, lang: string | null | undefined): string {
  const en = lang === 'en';
  const formal = lang === 'zh-written';
  const hint = field.hint?.trim();

  switch (field.field_key) {
    case 'target_height':
      return en
        ? 'About how tall should they be? (cm)'
        : formal
          ? '期望對象身高大約多少？（cm）'
          : '期望對象身高大概幾多高？（cm）';
    case 'target_bodyshape':
      return en
        ? 'What body type are you into? (e.g. slim, athletic)'
        : formal
          ? '期望對象的身形？（例如：纖瘦、健壯）'
          : '你鍾意咩身形？（例如：纖瘦、健壯、勻稱）';
    case 'member_height':
      return en ? 'Your height? (cm)' : formal ? '你的身高？（cm）' : '你身高幾多 cm？';
    case 'member_weight':
      return en ? 'Your weight? (kg)' : formal ? '你的體重？（kg）' : '體重大概幾多 kg？';
    case 'member_sexual_experience':
      return en
        ? 'Briefly share your sexual experience (optional detail level is up to you):'
        : formal
          ? '請簡述你的性經驗（可詳可略）：'
          : '方便講多少少你嘅性經驗？（想講幾詳都得）';
    case 'member_profile':
      return en
        ? 'Write a short intro about yourself — personality, lifestyle, what makes you interesting:'
        : formal
          ? '寫一段個人簡介——性格、生活、想讓對方認識你的地方：'
          : '寫段簡介等大家了解你～性格、生活、有咩特色都可以講：';
    case 'other_sexual_interests':
      return en
        ? 'Any other interests or preferences to mention?'
        : formal
          ? '還有其他性趣或偏好想補充嗎？'
          : '有冇其他性趣或者偏好想補充？';
    default:
      return en
        ? `Please enter: ${field.label_zh}${hint ? `\n${hint}` : ''}`
        : formal
          ? `請輸入：${field.label_zh}${hint ? `\n（${hint}）` : ''}`
          : `請輸入：${field.label_zh}${hint ? `\n（${hint}）` : ''}`;
  }
}

export function buildQuestionnaireIntro(
  lang: string | null | undefined,
  needsUsername: boolean,
): string {
  const en = lang === 'en';
  const formal = lang === 'zh-written';
  const usernameNote = needsUsername
    ? en
      ? '\n\n(Tip: set a Telegram @username before publishing.)'
      : formal
        ? '\n\n（提示：發佈前請在 Telegram 設定 @username。）'
        : '\n\n（提提你：發佈前記得喺 Telegram 設定 @username）'
    : '';

  if (en) {
    return `Great — basic profile is done! Let's fill in your post step by step so the right people can find you.${usernameNote}`;
  }
  if (formal) {
    return `基本資料已完成！接下來我們逐步填寫啟示，讓合適的人認識你。${usernameNote}`;
  }
  return spoken(lang)
    ? `基本資料搞掂～而家一齊填啟示，等啱嘅人認識你。${usernameNote}`
    : `基本資料搞掂～而家一齊填啟示，等啱嘅人認識你。${usernameNote}`;
}

export function buildAcceptanceIntro(
  targetGender: '男' | '女',
  lang: string | null | undefined,
  previous?: SavedFieldAnswer,
): string {
  const en = lang === 'en';
  const formal = lang === 'zh-written';
  const lead = previous
    ? `${ackValue(previous.fieldKey, previous.value, lang)}\n\n`
    : '';

  if (en) {
    return `${lead}Almost there! For each item below, tell me what you're okay with (target: ${targetGender === '女' ? 'female' : 'male'}):`;
  }
  if (formal) {
    return `${lead}快完成了！請逐項選擇可接受程度（對象：${targetGender}）：`;
  }
  return `${lead}差唔多啦～跟住想了解下你對親密行為嘅接受程度（對象：${targetGender}），逐項揀：`;
}

/** One cohesive bot message: optional ack of previous answer + natural lead-in to next question. */
export function buildQuestionnairePrompt(
  field: PostFieldDef,
  lang: string | null | undefined,
  options?: {
    previous?: SavedFieldAnswer;
    hasChoiceOptions?: boolean;
  },
): string {
  const en = lang === 'en';
  const formal = lang === 'zh-written';
  const parts: string[] = [];

  if (options?.previous) {
    parts.push(ackValue(options.previous.fieldKey, options.previous.value, lang));
  }

  const ask = options?.hasChoiceOptions ? askChoice(field, lang) : askText(field, lang);
  parts.push(ask);

  if (options?.hasChoiceOptions) {
    parts.push(en ? 'Pick one below:' : formal ? '請在下方選擇：' : '下面揀一個：');
  }

  return parts.join('\n\n');
}

/** User-side chat log line for a saved answer. */
export function formatUserAnswerLog(answer: SavedFieldAnswer): string {
  return `${answer.label}：${answer.value}`;
}
