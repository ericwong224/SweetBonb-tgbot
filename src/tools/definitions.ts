import type OpenAI from 'openai';

export const TOOL_DEFINITIONS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'member_info',
      description: 'Get member profile, post status, and post data for a Telegram user',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'integer', description: 'Telegram user id' },
        },
        required: ['user_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_g_info',
      description: 'Update member basic info: gender, dob, location, username',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'integer' },
          field: { type: 'string', enum: ['gender', 'dob', 'location', 'username'] },
          value: { type: 'string' },
        },
        required: ['user_id', 'field', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_post_data',
      description: 'Get all saved post/revelation data items for a user',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'integer' },
        },
        required: ['user_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_post_data',
      description: 'Save or update a post data item for a user',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'integer' },
          item: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['user_id', 'item', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_post_data',
      description: 'Check which required post data items are missing',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'integer' },
        },
        required: ['user_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'post2draft',
      description: 'Set user post status to draft (stop publishing)',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'integer' },
        },
        required: ['user_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'post2publish',
      description:
        'Publish user revelation: detailed post to regional channel, short post to main channel. Call channel_info first to pick regional_channel_id from user location.',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'integer' },
          regional_channel_id: {
            type: 'string',
            description:
              'Regional channel id from channel_info.regional_channels (string, AI picks by user location)',
          },
        },
        required: ['user_id', 'regional_channel_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'channel_info',
      description:
        'List main channel and regional post channels (for AI to map user location to regional_channel_id)',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_member',
      description:
        'Check if a user has joined a Telegram channel. joined=true only for creator, administrator, or member status.',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'integer' },
          channel_id: {
            type: 'string',
            description: 'Channel id from channel_info (string)',
          },
        },
        required: ['user_id', 'channel_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'match_request',
      description: 'Get pending match requests for a target user',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'integer' },
        },
        required: ['user_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'match_reply',
      description: 'Accept or reject a match request',
      parameters: {
        type: 'object',
        properties: {
          match_id: { type: 'integer' },
          action: { type: 'string', enum: ['accept', 'reject'] },
        },
        required: ['match_id', 'action'],
      },
    },
  },
];
