'use strict';

// Быстрый эксперимент с формой запроса: node tools/probe4.js "текст"
const crypto = require('node:crypto');
const { WsClient } = require('../src/ws');
const config = require('../src/config');

const ID = () => crypto.randomUUID();
const text = process.argv[2] || 'Напиши функцию на Python для реверса строки, только код.';
const dialogId = process.env.DIALOG_ID || crypto.randomUUID();
const mode = process.env.MODE || 'Pro';

const ws = new WsClient(config.wsUrl, {
  Origin: config.origin,
  'User-Agent': config.userAgent,
  Cookie: config.cookie || undefined,
});

const requestId = ID();
let seq = 2;

const FEATURES = [
  'background_response_streaming_for_dialog_controls',
  'background_response_streaming_in_read_dialog',
  'background_response_streaming',
  'supports_bso_answer',
  'open_link',
  'server_action',
  'show_promo',
  'reminders_and_todos',
  'div2_cards',
  'player_pause_directive',
  'can_open_dialogs_in_tabs',
  'supports_streaming_response',
  'supports_rich_json_cards',
  'builtin_reaction',
  'open_link_by_button',
  'supports_origin_in_separate_card',
  'supports_new_sources_cards',
  'supports_markdown_response',
  'supported_save_chathistory',
  'supported_load_chathistory',
  'supports_unlimited_dialogs_creation',
  'supports_multi_model_dialogs',
  'print_text_in_message_view',
  'show_loader_directive',
  'supports_stringbody_in_div2_card',
  'supports_default_dialog_as_dedicated',
  'background_response_streaming_anon',
  'whisper',
];

const EXPERIMENTS = [
  'dont_skip_cancel_requests',
  'enable_parallel_requests_to_chats',
  'read_dialogs_for_unauthorized_users',
  'mm_allow_anonymous_request',
  'enable_external_skills_for_webdesktop_and_webtouch',
  'send_show_view_directive_on_supports_show_view_layer_content_interface',
  'standalone_alice_2_0',
  'mm_enable_protocol_scenario=WebAliceControls',
  'exp_flag_chat_dialog_history',
  'exp_flag_chat_dialog_history_main_context_save',
  'div2cards_in_external_skills_for_web_standalone',
  'enable_find_poi_standalone',
  'use_server_pings',
  'enable_onboarding_adaptive_size',
  'standalone_show_fullscreen_image_gallery_directive',
  'draw_picture_enable_controls',
  'alice_has_borders_div_paddings',
  'enable_new_colors_for_alice_chat',
  'erase_serialized_response_from_json_deferred_alice_response',
  'skills_standalone_use_div_render',
  'standalone_skill_card_cloud_ui',
  'agent_platform_exp_ai_incentives_acceptor_cashback_v1',
];

const uuid = '00000000000007900212181793992330';

const capabilities = [
  { '@type': 'type.googleapis.com/NAlice.TAliceCapability', meta: {}, parameters: {}, state: {} },
  {
    '@type': 'type.googleapis.com/NAlice.TAliceChatCapability',
    meta: {
      supported_directives: [
        'ScrollToFragmentDirectiveType',
        'LoginWithCallbackDirectiveType',
        'LimitExceededBannerDirectiveType',
        'FewRequestsLeftBannerDirective',
        'ShowBannerDirectiveType',
        'ShowProPurchaseScreenDirectiveType',
        'ShowModalDirectiveType',
        'ShowNotificationDirectiveType',
        'SetChatRequestModeDirectiveType',
        'ShowFullscreenImageGalleryDirectiveType',
        'ZoomImageDirectiveType',
        'DownloadImageDirectiveType',
        'FillChatInputDirectiveType',
        'FinishChatDirectiveType',
        'CreateNewChatDirectiveType',
        'OpenChatListDirectiveType',
        'ChatNavigateBackDirectiveType',
        'SuggestReaskDirectiveType',
      ],
    },
    parameters: {
      supports_rich_answers: true,
      supports_rich_suggests: true,
      supports_rich_summary: true,
    },
    state: {
      navigation_state: {
        topmost_navigation_entry: {
          id: 'chat',
          type: 'Chat',
          title: 'Чат с Алисой',
          can_navigate_back: false,
        },
      },
      active_chat_dialog_context: {
        dialog_id: dialogId,
        dialog_type: 'DEDICATED_CHAT',
        alice2_mode_info: { preset: '', mode },
      },
    },
  },
  { '@type': 'type.googleapis.com/NAlice.TAliceProCapability', meta: { supported_directives: ['OpenProPurchaseScreenDirectiveType'] }, parameters: {}, state: {} },
  { '@type': 'type.googleapis.com/NAlice.TBestPriceChatCapability', meta: {}, state: {} },
  { '@type': 'type.googleapis.com/NAlice.TDivViewCapability', meta: {}, parameters: {}, state: {} },
  { '@type': 'type.googleapis.com/NAlice.TPersonalDeviceCapability', meta: {}, parameters: {}, state: {} },
  { '@type': 'type.googleapis.com/NAlice.TRetrieveSourcesCapability', meta: {}, parameters: { sources: [] }, state: {} },
  { '@type': 'type.googleapis.com/NAlice.TAliceLimitsCapability', meta: { supported_directives: ['ExpertLimitNoticeDirectiveType', 'LimitUpdatedDirectiveType'] }, parameters: {}, state: {} },
  { '@type': 'type.googleapis.com/NAlice.TAliceAppsWidgetCapability', meta: {}, parameters: {}, state: { widget_states: [] } },
  { '@type': 'type.googleapis.com/NAlice.TAliceAppsCapability', meta: { supported_directives: ['AliceAppsSelectDirectiveType'] }, parameters: {}, state: {} },
  { '@type': 'type.googleapis.com/NAlice.TJeevesCapability', meta: {}, parameters: {}, state: { enabled_plugin_ids: [] } },
];

ws.on('open', () => {
  ws.sendJSON({
    event: {
      header: { namespace: 'System', name: 'SynchronizeState', seqNumber: 1, messageId: ID() },
      payload: {
        accept_invalid_auth: true,
        auth_token: config.apiKeyUpstream,
        uuid,
        yandexuid: uuid,
        vins: {
          application: {
            app_id: config.appId,
            platform: 'windows',
            device_id: uuid,
            device_model: 'desktop',
            device_firmware: 'windows',
          },
        },
        supported_features: FEATURES,
        request: { experiments: EXPERIMENTS },
        speechkitVersion: '4.16.7',
        client_analytics_info: { client_url: 'https://alice.yandex.ru/' },
      },
    },
  });

  ws.sendJSON({
    event: {
      header: {
        namespace: 'Vins',
        name: 'TextInput',
        messageId: requestId,
        seqNumber: seq++,
      },
      payload: {
        application: {
          app_id: config.appId,
          app_version: 'unknown',
          platform: 'windows',
          os_version: config.userAgent.toLowerCase(),
          uuid,
          device_id: uuid,
          lang: 'ru-RU',
          client_time: new Date().toISOString().slice(0, 19).replace(/[:+-]/g, ''),
          timezone: 'Europe/Moscow',
          timestamp: String(Date.now()).slice(0, -3),
        },
        header: { request_id: requestId, dialog_id: dialogId, dialog_type: 2 },
        request: {
          event: { type: 'text_input', text },
          voice_session: false,
          experiments: EXPERIMENTS,
          uniproxy_options: {
            background_response_streaming_options: { request_with_shown_new_dialog: {} },
          },
          additional_options: {
            bass_options: { user_agent: config.userAgent, screen_scale_factor: 1 },
            origin_domain: 'yandex.ru',
            supported_features: FEATURES,
            unsupported_features: [],
            icookie: '',
          },
          environment_state: { endpoints: [{ id: uuid, capabilities }] },
        },
        topic: 'desktopgeneral',
        punctuation: false,
        alice_2_settings: { preset: '', mode },
      },
    },
  });
});

let textSoFar = '';
ws.on('message', (raw) => {
  let f;
  try {
    f = JSON.parse(raw);
  } catch {
    return;
  }
  if (f.streamcontrol) {
    if (process.env.DUMP) console.error('STREAMCONTROL', JSON.stringify(f.streamcontrol).slice(0, 300));
    return;
  }
  const h = f.directive?.header;
  if (!h) return;
  if (process.env.DUMP) {
    console.error(
      `<< ${h.namespace}/${h.name} ` + JSON.stringify(f.directive.payload).slice(0, 600)
    );
  }
  if (h.name === 'Ping') {
    ws.sendJSON({
      event: {
        header: { namespace: 'System', name: 'Pong', messageId: ID(), refMessageId: h.messageId },
        payload: {},
      },
    });
    return;
  }
  const dirs = [
    ...(f.directive.payload?.response?.response?.directives || []),
    ...(f.directive.payload?.response?.json_response?.base_response?.directives || []),
  ];
  const jr = f.directive.payload?.json_response;
  if (jr?.base_response) {
    const br = jr.base_response;
    const t = br.text || br.cards?.[0]?.text_card?.text || '';
    if (t) {
      process.stdout.write(t.startsWith(textSoFar) ? t.slice(textSoFar.length) : t);
      textSoFar = t;
    }
    if (jr.is_last) {
      console.log(`\n--- END (${textSoFar.length} chars)`);
      ws.destroy();
      setTimeout(() => process.exit(0), 100);
      return;
    }
  }
  for (const d of dirs) {
    if (d.name === 'print_text_in_message_view') {
      const t = d.payload?.text || '';
      process.stdout.write(t.slice(textSoFar.length) || '');
      textSoFar = t;
      if (String(d.payload?.status) === 'end') {
        console.log(`\n--- END (${textSoFar.length} chars)`);
        ws.destroy();
        setTimeout(() => process.exit(0), 100);
      }
    }
  }
});

ws.on('error', (e) => console.error('ERR', e.message));
ws.connect();
setTimeout(() => {
  console.log(`\n--- TIMEOUT (${textSoFar.length} chars)`);
  ws.destroy();
  process.exit(0);
}, 60000);
