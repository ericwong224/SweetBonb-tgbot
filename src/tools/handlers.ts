import type { Api } from 'grammy';
import type { AppConfig } from '../config.js';
import { getPendingMatchRequests, updateMatchStatus } from '../db/matches.js';
import {
  buildPostFormat2,
  calcAge,
  checkPostData,
  getChannelInfo,
  getPostDataMap,
  savePostDataItem,
} from '../db/posts.js';
import {
  buildMemberInfo,
  getUser,
  updatePostFormat,
  updatePostStatus,
  updateUserField,
} from '../db/users.js';

export interface ToolContext {
  config: AppConfig;
  api: Api;
}

export async function executeTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'member_info':
      return memberInfo(ctx, args);
    case 'edit_g_info':
      return editGInfo(ctx, args);
    case 'get_post_data':
      return getPostData(ctx, args);
    case 'save_post_data':
      return savePostData(ctx, args);
    case 'check_post_data':
      return checkPostDataTool(ctx, args);
    case 'channel_info':
      return channelInfo(ctx);
    case 'check_member':
      return checkMember(ctx, args);
    case 'match_request':
      return matchRequest(ctx, args);
    case 'match_reply':
      return matchReply(ctx, args);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function memberInfo(ctx: ToolContext, args: Record<string, unknown>) {
  const userId = Number(args.user_id);
  const user = await getUser(ctx.config, userId);
  const postData = await getPostDataMap(ctx.config, userId);
  return buildMemberInfo(user, postData);
}

async function editGInfo(ctx: ToolContext, args: Record<string, unknown>) {
  const userId = Number(args.user_id);
  const field = String(args.field) as 'gender' | 'dob' | 'location' | 'username';
  const value = String(args.value);

  if (field === 'gender' && !['M', 'F', '男', '女'].includes(value)) {
    return { error: 'gender must be M/F or 男/女' };
  }

  const normalized =
    field === 'gender' ? (value === '男' ? 'M' : value === '女' ? 'F' : value) : value;

  await updateUserField(ctx.config, userId, field, normalized);
  return { success: true, field, value: normalized };
}

async function getPostData(ctx: ToolContext, args: Record<string, unknown>) {
  const userId = Number(args.user_id);
  return getPostDataMap(ctx.config, userId);
}

async function savePostData(ctx: ToolContext, args: Record<string, unknown>) {
  const userId = Number(args.user_id);
  const item = String(args.item);
  const content = String(args.content);
  await savePostDataItem(ctx.config, userId, item, content);

  const user = await getUser(ctx.config, userId);
  const postData = await getPostDataMap(ctx.config, userId);
  postData[item] = content;

  if (user?.dob && user.gender && user.location) {
    const age = calcAge(new Date(user.dob));
    const format = buildPostFormat2(
      user.location,
      user.gender,
      age,
      postData.member_relationship_status ?? '單身',
      postData.member_height ?? '',
      postData.member_weight ?? '',
      postData,
      postData.secure_pairing_options ?? '',
    );
    await updatePostFormat(ctx.config, userId, format);
  }

  return { success: true, item, content };
}

async function checkPostDataTool(ctx: ToolContext, args: Record<string, unknown>) {
  const userId = Number(args.user_id);
  return checkPostData(ctx.config, userId);
}

async function channelInfo(ctx: ToolContext) {
  return getChannelInfo(ctx.config);
}

async function checkMember(ctx: ToolContext, args: Record<string, unknown>) {
  const userId = Number(args.user_id);
  const channelId = Number(args.channel_id);

  try {
    const member = await ctx.api.getChatMember(channelId, userId);
    const joined = !['left', 'kicked', 'banned'].includes(member.status);
    return { channel_id: channelId, user_id: userId, joined, status: member.status };
  } catch (error) {
    return {
      channel_id: channelId,
      user_id: userId,
      joined: false,
      error: error instanceof Error ? error.message : 'check failed',
    };
  }
}

async function matchRequest(ctx: ToolContext, args: Record<string, unknown>) {
  const userId = Number(args.user_id);
  const rows = await getPendingMatchRequests(ctx.config, userId);
  return rows.map((row) => ({
    match_id: row.match_id,
    initiator_id: row.initiator_id,
    match_status: row.match_status,
    initiator_data: row.initiator_data,
    match_rate: row.match_rate,
  }));
}

async function matchReply(ctx: ToolContext, args: Record<string, unknown>) {
  const matchId = Number(args.match_id);
  const action = String(args.action);
  const status = action === 'accept' ? 'accept' : 'reject';
  await updateMatchStatus(ctx.config, matchId, status);
  return { success: true, match_id: matchId, status };
}

export async function refreshPostFormat(ctx: ToolContext, userId: number) {
  const user = await getUser(ctx.config, userId);
  if (!user?.dob || !user.gender || !user.location) return;

  const postData = await getPostDataMap(ctx.config, userId);
  const format = buildPostFormat2(
    user.location,
    user.gender,
    calcAge(new Date(user.dob)),
    postData.member_relationship_status ?? '單身',
    postData.member_height ?? '',
    postData.member_weight ?? '',
    postData,
    postData.secure_pairing_options ?? '',
  );
  await updatePostFormat(ctx.config, userId, format);
}

export { updatePostStatus };
