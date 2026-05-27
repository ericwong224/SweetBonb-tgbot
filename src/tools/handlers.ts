import type { Api } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { AppConfig } from '../config.js';
import {
  checkPostResponsesComplete,
  getPostFieldDefs,
  getPostResponseMap,
  savePostResponse,
} from '../db/post-fields.js';
import {
  filterTargetRelationshipOptions,
  isTargetRelationshipChoiceAllowed,
  matchChoiceFieldOption,
  getFieldOptions,
  TARGET_RELATIONSHIP_LONG_TERM,
} from '../bot/field-choices.js';
import {
  getProfile,
  isCoreProfileComplete,
  isProfileComplete,
  profileToMemberInfo,
  updateProfileField,
} from '../db/profile.js';
import {
  buildChannelMessageLink,
  checkPublishChannelMembership,
  isUserChannelMember,
  normalizeTelegramChatId,
} from '../db/channels.js';
import {
  buildPostFormatsFromProfile,
  getChannelInfo,
} from '../db/posts.js';
import {
  getPendingTgMatchRequests,
  updateTgMatchStatus,
} from '../db/tg-match.js';
import {
  getUserPost,
  isPostPublished,
  markUserPostPublished,
  resetUserPostDraft,
  setUserPostStatus,
  updateUserPostBody,
} from '../db/user-post.js';
import { getUser } from '../db/users.js';
import { resolveUserStage, type UserStage } from '../flow/stages.js';

export interface ToolContext {
  config: AppConfig;
  api: Api;
  userId?: number;
  botUsername?: string;
  userStage?: UserStage;
}

function withDefaultUserId(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (ctx.userId != null && (args.user_id == null || args.user_id === '')) {
    return { ...args, user_id: ctx.userId };
  }
  return args;
}

function gateError(message: string) {
  return { error: message, gated: true };
}

async function requireCoreProfileComplete(ctx: ToolContext, userId: number) {
  const profile = await getProfile(ctx.config, userId);
  if (!isCoreProfileComplete(profile)) {
    return gateError(`基本資料未完成：${profile ? '缺少性別/出生日期/居住地' : '找不到用戶'}`);
  }
  return null;
}

async function requireFullProfileComplete(ctx: ToolContext, userId: number) {
  const profile = await getProfile(ctx.config, userId);
  if (!isProfileComplete(profile)) {
    if (isCoreProfileComplete(profile) && !profile?.telegram_username?.trim()) {
      return gateError(
        '請先到 Telegram → 設定 → 用戶名，自行設定 @username 後再發訊息，bot 會自動同步',
      );
    }
    return gateError(`基本資料未完成：${profile ? '缺少必填欄位' : '找不到用戶'}`);
  }
  return null;
}

async function requirePublished(ctx: ToolContext, userId: number) {
  const post = await getUserPost(ctx.config, userId);
  if (!isPostPublished(post)) {
    return gateError('需要先發佈啟示才能使用此功能');
  }
  return null;
}

function validateDob(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'dob must be YYYY-MM-DD';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'invalid dob';
  return null;
}

export async function executeTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const resolvedArgs = withDefaultUserId(ctx, args);

  switch (name) {
    case 'member_info':
      return memberInfo(ctx, resolvedArgs);
    case 'edit_g_info':
      return editGInfo(ctx, resolvedArgs);
    case 'get_post_data':
      return getPostData(ctx, resolvedArgs);
    case 'save_post_data':
      return savePostData(ctx, resolvedArgs);
    case 'check_post_data':
      return checkPostDataTool(ctx, resolvedArgs);
    case 'post2draft':
      return post2draft(ctx, resolvedArgs);
    case 'post2publish':
      return post2publish(ctx, resolvedArgs);
    case 'channel_info':
      return channelInfo(ctx);
    case 'check_member':
      return checkMember(ctx, resolvedArgs);
    case 'match_request':
      return matchRequest(ctx, resolvedArgs);
    case 'match_reply':
      return matchReply(ctx, resolvedArgs);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function memberInfo(ctx: ToolContext, args: Record<string, unknown>) {
  const userId = Number(args.user_id);
  const profile = await getProfile(ctx.config, userId);
  const postData = await getPostResponseMap(ctx.config, userId);
  const userPost = await getUserPost(ctx.config, userId);
  const stage = ctx.userStage ?? (await resolveUserStage(ctx.config, userId));
  return {
    ...profileToMemberInfo(profile, postData, userPost?.status ?? 'draft', userPost?.body_format ?? null),
    stage,
    acc_block: (await getUser(ctx.config, userId))?.acc_block === 1,
  };
}

async function editGInfo(ctx: ToolContext, args: Record<string, unknown>) {
  const userId = Number(args.user_id);
  const field = String(args.field) as 'gender' | 'dob' | 'location' | 'username';
  const value = String(args.value).trim();

  if (!value) return gateError('value cannot be empty');

  if (field === 'username') {
    return gateError(
      '@username 須用戶自行到 Telegram 設定，bot 會在用戶設定後自動同步，請勿手動填入',
    );
  }

  if (field === 'gender') {
    if (!['M', 'F', '男', '女'].includes(value)) {
      return gateError('性別只有「男」或「女」，必須選擇其中一項');
    }
  }

  if (field === 'dob') {
    const err = validateDob(value);
    if (err) return gateError(err);
  }

  const normalized =
    field === 'gender' ? (value === '男' ? 'M' : value === '女' ? 'F' : value) : value;

  await updateProfileField(ctx.config, userId, field, normalized);
  await resolveUserStage(ctx.config, userId);
  return { success: true, field, value: normalized };
}

async function getPostData(ctx: ToolContext, args: Record<string, unknown>) {
  const userId = Number(args.user_id);
  const blocked = await requireCoreProfileComplete(ctx, userId);
  if (blocked) return blocked;
  return getPostResponseMap(ctx.config, userId);
}

async function savePostData(ctx: ToolContext, args: Record<string, unknown>) {
  const userId = Number(args.user_id);
  const blocked = await requireCoreProfileComplete(ctx, userId);
  if (blocked) return blocked;

  const item = String(args.item);
  let content = String(args.content).trim();
  if (!content) return gateError('content cannot be empty');

  const postData = await getPostResponseMap(ctx.config, userId);
  const defs = await getPostFieldDefs(ctx.config);
  const def = defs.find((d) => d.field_key === item);
  let options = def ? getFieldOptions(def) : [];
  if (item === 'target_relationship') {
    options = filterTargetRelationshipOptions(options, postData.member_relationship_status);
  }
  if (options.length) {
    const matched = matchChoiceFieldOption(item, options, content);
    if (!matched) {
      const hint =
        item === 'target_age'
          ? '格式如 18-20（範圍）或 20+（即 20 歲或以上）'
          : item === 'target_relationship'
            ? '必須從以下選項選擇（「情侶-長遠發展」只限單身）：' + options.join('、')
            : `必須從以下選項選擇：${options.join('、')}`;
      return gateError(`「${def?.label_zh ?? item}」${hint}`);
    }
    if (
      item === 'target_relationship' &&
      !isTargetRelationshipChoiceAllowed(postData.member_relationship_status, matched)
    ) {
      return gateError('「情侶-長遠發展」只限感情狀況為單身的用戶選擇');
    }
    content = matched;
  }

  await savePostResponse(ctx.config, userId, item, content);
  if (
    item === 'member_relationship_status' &&
    content !== '單身' &&
    postData.target_relationship === TARGET_RELATIONSHIP_LONG_TERM
  ) {
    await savePostResponse(ctx.config, userId, 'target_relationship', '');
  }
  await resetUserPostDraft(ctx.config, userId);

  const profile = await getProfile(ctx.config, userId);
  const postDataAfter = await getPostResponseMap(ctx.config, userId);

  if (isCoreProfileComplete(profile) && profile?.dob && profile.gender && profile.location) {
    const formats = buildPostFormatsFromProfile(
      profile.location,
      profile.gender,
      new Date(profile.dob),
      postDataAfter,
    );
    await updateUserPostBody(ctx.config, userId, formats.detailed, formats.short);
  }

  await resolveUserStage(ctx.config, userId);
  return { success: true, item, content };
}

async function post2draft(ctx: ToolContext, args: Record<string, unknown>) {
  const userId = Number(args.user_id);
  const blocked = await requireCoreProfileComplete(ctx, userId);
  if (blocked) return blocked;
  await setUserPostStatus(ctx.config, userId, 'draft');
  await resolveUserStage(ctx.config, userId);
  return { success: true, user_id: userId, post_on: 'draft' };
}

async function checkPostDataTool(ctx: ToolContext, args: Record<string, unknown>) {
  const userId = Number(args.user_id);
  const blocked = await requireCoreProfileComplete(ctx, userId);
  if (blocked) return blocked;
  return checkPostResponsesComplete(ctx.config, userId);
}

async function post2publish(ctx: ToolContext, args: Record<string, unknown>) {
  const userId = Number(args.user_id);
  const blocked = await requireFullProfileComplete(ctx, userId);
  if (blocked) return blocked;

  const postCheck = await checkPostResponsesComplete(ctx.config, userId);
  if (!postCheck.complete) {
    return gateError(`啟示問卷未完成，缺少：${postCheck.missing.join(', ')}`);
  }

  const profile = await getProfile(ctx.config, userId);
  if (!profile?.location) return gateError('缺少現居地，無法選擇頻道');

  const channelCheck = await checkPublishChannelMembership(
    ctx.api,
    ctx.config,
    userId,
    profile.location,
  );

  if (!channelCheck.mainChannel) {
    return gateError('找不到總頻設定，請聯絡管理員');
  }
  if (!channelCheck.regionalChannel) {
    return gateError(
      `找不到 ${profile.location} 對應的地區發佈頻道（請確認現居地格式，例如：香港-九龍）`,
    );
  }

  if (channelCheck.checkErrors.length > 0) {
    const detail = channelCheck.checkErrors
      .map((e) => `${e.label}（${e.display}）：${e.error}`)
      .join('；');
    return gateError(
      `無法驗證頻道會籍：${detail}。請確認 bot 已加入並為該頻道管理員。`,
    );
  }

  if (!channelCheck.ok) {
    const names = channelCheck.missing.map((m) => `${m.label}（${m.display}）`).join('、');
    return gateError(`發佈前請先加入以下頻道：${names}`);
  }

  const regionalChannelId = normalizeTelegramChatId(channelCheck.regionalChannel.channel_id);
  const mainChannelId = normalizeTelegramChatId(channelCheck.mainChannel.channel_id);

  const userPost = await getUserPost(ctx.config, userId);
  let detailedBody = userPost?.body_format;
  let shortBody = userPost?.body_short;
  if (!detailedBody || !shortBody) {
    await refreshPostFormat(ctx, userId);
    const refreshed = await getUserPost(ctx.config, userId);
    detailedBody = refreshed?.body_format ?? undefined;
    shortBody = refreshed?.body_short ?? undefined;
  }
  if (!detailedBody || !shortBody) return gateError('無法生成啟示內容');

  const botUser = ctx.botUsername ?? 'sweetbonb_bot';
  const footer = `\n\n👉 配對請按：https://t.me/${botUser}?start=match-target-${userId}`;
  const detailedText = detailedBody + footer;

  const regionalSent = await ctx.api.sendMessage(regionalChannelId, detailedText);
  const detailLink = buildChannelMessageLink(
    Number(channelCheck.regionalChannel.channel_id),
    regionalSent.message_id,
    channelCheck.regionalChannel.channel_username,
  );

  const mainKeyboard = new InlineKeyboard().url('查看詳細啟示', detailLink);
  const mainSent = await ctx.api.sendMessage(mainChannelId, shortBody, {
    reply_markup: mainKeyboard,
  });

  await markUserPostPublished(
    ctx.config,
    userId,
    Number(channelCheck.regionalChannel.channel_id),
    regionalSent.message_id,
    Number(channelCheck.mainChannel.channel_id),
    mainSent.message_id,
  );
  await resolveUserStage(ctx.config, userId);

  return {
    success: true,
    regional_channel_id: regionalChannelId,
    regional_message_id: regionalSent.message_id,
    main_channel_id: mainChannelId,
    main_message_id: mainSent.message_id,
    detail_link: detailLink,
    status: 'publish',
  };
}

async function channelInfo(ctx: ToolContext) {
  return getChannelInfo(ctx.config);
}

async function checkMember(ctx: ToolContext, args: Record<string, unknown>) {
  const userId = Number(args.user_id);
  const channelId = args.channel_id as number | string;

  const result = await isUserChannelMember(ctx.api, userId, channelId);
  return {
    channel_id: channelId,
    user_id: userId,
    joined: result.joined,
    status: result.status ?? null,
    error: result.error ?? null,
  };
}

async function matchRequest(ctx: ToolContext, args: Record<string, unknown>) {
  const userId = Number(args.user_id);
  const blocked = await requirePublished(ctx, userId);
  if (blocked) return blocked;

  const rows = await getPendingTgMatchRequests(ctx.config, userId);
  return rows.map((row) => ({
    match_id: row.match_id,
    initiator_id: row.initiator_id,
    match_status: row.status,
    initiator_data: row.initiator_snapshot,
    match_rate: row.match_rate,
  }));
}

async function matchReply(ctx: ToolContext, args: Record<string, unknown>) {
  const matchId = Number(args.match_id);
  const action = String(args.action);
  const status = action === 'accept' ? 'accept' : 'reject';
  await updateTgMatchStatus(ctx.config, matchId, status);
  return { success: true, match_id: matchId, status };
}

export async function refreshPostFormat(ctx: ToolContext, userId: number) {
  const profile = await getProfile(ctx.config, userId);
  if (!isCoreProfileComplete(profile) || !profile?.dob || !profile.gender || !profile.location) return;

  const postData = await getPostResponseMap(ctx.config, userId);
  const formats = buildPostFormatsFromProfile(
    profile.location,
    profile.gender,
    new Date(profile.dob),
    postData,
  );
  await updateUserPostBody(ctx.config, userId, formats.detailed, formats.short);
}

export { setUserPostStatus };
