'use strict';

/**
 * Константы протокола uniproxy / Alice AI, снятые с живого веб-клиента.
 * Всё, что здесь есть, — это то, что реально отправляет alice.yandex.ru,
 * иначе сервер уводит запрос в сценарий GeneralConversation (старая Алиса).
 */

const DIALOG_TYPE_DEDICATED_CHAT = 2;

const SUPPORTED_FEATURES = [
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

const CHAT_DIRECTIVES = [
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
];

/** capabilities устройства: именно они говорят серверу «это чат-диалог, а не болталка». */
function capabilities({ deviceId, dialogId, mode }) {
  return [
    { '@type': 'type.googleapis.com/NAlice.TAliceCapability', meta: {}, parameters: {}, state: {} },
    {
      '@type': 'type.googleapis.com/NAlice.TAliceChatCapability',
      meta: { supported_directives: CHAT_DIRECTIVES },
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
    {
      '@type': 'type.googleapis.com/NAlice.TAliceProCapability',
      meta: { supported_directives: ['OpenProPurchaseScreenDirectiveType'] },
      parameters: {},
      state: {},
    },
    { '@type': 'type.googleapis.com/NAlice.TBestPriceChatCapability', meta: {}, state: {} },
    { '@type': 'type.googleapis.com/NAlice.TDivViewCapability', meta: {}, parameters: {}, state: {} },
    {
      '@type': 'type.googleapis.com/NAlice.TPersonalDeviceCapability',
      meta: {},
      parameters: {},
      state: {},
    },
    {
      '@type': 'type.googleapis.com/NAlice.TRetrieveSourcesCapability',
      meta: {},
      parameters: { sources: [] },
      state: {},
    },
    {
      '@type': 'type.googleapis.com/NAlice.TAliceLimitsCapability',
      meta: { supported_directives: ['ExpertLimitNoticeDirectiveType', 'LimitUpdatedDirectiveType'] },
      parameters: {},
      state: {},
    },
    {
      '@type': 'type.googleapis.com/NAlice.TAliceAppsWidgetCapability',
      meta: {},
      parameters: {},
      state: { widget_states: [] },
    },
    {
      '@type': 'type.googleapis.com/NAlice.TAliceAppsCapability',
      meta: { supported_directives: ['AliceAppsSelectDirectiveType'] },
      parameters: {},
      state: {},
    },
    {
      '@type': 'type.googleapis.com/NAlice.TJeevesCapability',
      meta: {},
      parameters: {},
      state: { enabled_plugin_ids: [] },
    },
  ];
}

function syncPayload({ appId, platform, uuid, deviceId, deviceModel, deviceFirmware, features, experiments }) {
  return {
    accept_invalid_auth: true,
    auth_token: undefined, // подставит вызывающий
    uuid,
    yandexuid: uuid,
    vins: {
      application: {
        app_id: appId,
        platform,
        device_id: deviceId,
        device_model: deviceModel,
        device_firmware: deviceFirmware,
      },
    },
    supported_features: features,
    request: { experiments },
    speechkitVersion: '4.16.7',
    client_analytics_info: { client_url: 'https://alice.yandex.ru/' },
  };
}

function textInputPayload({
  appId,
  appVersion,
  platform,
  userAgent,
  uuid,
  deviceId,
  deviceModel,
  deviceFirmware,
  lang,
  timezone,
  clientTime,
  timestamp,
  requestId,
  prevReqId,
  dialogId,
  text,
  mode,
  features,
  experiments,
  bassUrl,
  icookie,
}) {
  return {
    application: {
      app_id: appId,
      app_version: appVersion,
      platform,
      os_version: String(userAgent).toLowerCase(),
      uuid,
      device_id: deviceId,
      lang,
      client_time: clientTime,
      timezone,
      timestamp,
      device_model: deviceModel,
      device_firmware: deviceFirmware,
    },
    header: {
      prev_req_id: prevReqId || undefined,
      request_id: requestId,
      dialog_id: dialogId,
      dialog_type: DIALOG_TYPE_DEDICATED_CHAT,
    },
    request: {
      event: { type: 'text_input', text },
      voice_session: false,
      experiments,
      uniproxy_options: {
        background_response_streaming_options: {
          request_with_shown_new_dialog: prevReqId ? undefined : {},
        },
      },
      additional_options: {
        bass_url: bassUrl || undefined,
        bass_options: { user_agent: userAgent, screen_scale_factor: 1 },
        origin_domain: 'yandex.ru',
        supported_features: features,
        unsupported_features: [],
        icookie: icookie || '',
      },
      environment_state: {
        endpoints: [{ id: deviceId, capabilities: capabilities({ deviceId, dialogId, mode }) }],
      },
    },
    format: 'audio/ogg;codecs=opus',
    mime: 'audio/webm;codecs=opus',
    topic: 'desktopgeneral',
    punctuation: false,
    alice_2_settings: { preset: '', mode },
  };
}

module.exports = {
  SUPPORTED_FEATURES,
  EXPERIMENTS,
  DIALOG_TYPE_DEDICATED_CHAT,
  capabilities,
  syncPayload,
  textInputPayload,
};
