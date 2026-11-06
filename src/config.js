'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadDotEnv(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* no file, fine */
  }
}

loadDotEnv(path.join(__dirname, '..', '.env'));

const bool = (v, def = false) => {
  if (v === undefined || v === '') return def;
  return /^(1|true|yes|on)$/i.test(v);
};

const num = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const config = {
  // http server
  host: process.env.HOST || '127.0.0.1',
  port: num(process.env.PORT, 8787),
  // если задан — клиент обязан прислать x-api-key / Authorization: Bearer
  apiKey: process.env.PROXY_API_KEY || '',

  // upstream
  wsUrl: process.env.ALICE_WS_URL || 'wss://uniproxy.alice.yandex.net/uni.ws',
  origin: process.env.ALICE_ORIGIN || 'https://alice.yandex.ru',
  userAgent:
    process.env.ALICE_UA ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  // cookie из браузера (alice.yandex.ru). Пусто = анонимный режим.
  cookie: process.env.ALICE_COOKIE || '',
  appId: process.env.ALICE_APP_ID || 'ru.yandex.webstandalone.desktop',
  appVersion: process.env.ALICE_APP_VERSION || 'unknown',
  platform: process.env.ALICE_PLATFORM || 'windows',
  uuid: process.env.ALICE_UUID || '',
  deviceId: process.env.ALICE_DEVICE_ID || '',
  deviceModel: process.env.ALICE_DEVICE_MODEL || 'desktop',
  deviceFirmware: process.env.ALICE_DEVICE_FIRMWARE || 'windows',
  icookie: process.env.ALICE_ICOOKIE || '',
  timezone: process.env.ALICE_TIMEZONE || 'Europe/Moscow',
  lang: process.env.ALICE_LANG || 'ru-RU',
  apiKeyUpstream: process.env.ALICE_API_KEY || 'effd5a3f-fd42-4a18-83a1-61766a6d0924',
  bassUrl: process.env.ALICE_BASS_URL || '',
  location: process.env.ALICE_LOCATION || '',

  experiments: (
    process.env.ALICE_EXPERIMENTS ||
    [
      'dont_skip_cancel_requests',
      'enable_parallel_requests_to_chats',
      'read_dialogs_for_unauthorized_users',
      'mm_allow_anonymous_request',
      'enable_external_skills_for_webdesktop_and_webtouch',
      'standalone_alice_2_0',
      'exp_flag_chat_dialog_history',
      'exp_flag_chat_dialog_history_main_context_save',
      'use_server_pings',
      'enable_new_colors_for_alice_chat',
      'supports_markdown_response',
    ].join(',')
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  supportedFeatures: (
    process.env.ALICE_FEATURES ||
    [
      'background_response_streaming_for_dialog_controls',
      'background_response_streaming_in_read_dialog',
      'background_response_streaming',
      'supports_streaming_response',
      'supports_markdown_response',
      'supports_bso_answer',
      'supports_rich_json_cards',
      'supports_unlimited_dialogs_creation',
      'supports_multi_model_dialogs',
      'print_text_in_message_view',
      'supported_save_chathistory',
      'supported_load_chathistory',
    ].join(',')
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  defaultModel: process.env.DEFAULT_MODEL || 'alice-ai',
  // режим/модель Алисы: base | pro | yagpt_5_pro | yagpt_5_lite
  mode: process.env.ALICE_MODE || 'Base',
  modePreset: process.env.ALICE_MODE_PRESET || '',
  requestTimeoutMs: num(process.env.REQUEST_TIMEOUT_MS, 180000),
  toolEmulation: bool(process.env.TOOL_EMULATION, true),
  // бюджет промпта: веб-версия Алисы не тянет десятки тысяч символов
  maxPromptChars: num(process.env.MAX_PROMPT_CHARS, 16000),
  maxSystemChars: num(process.env.MAX_SYSTEM_CHARS, 6000),

  // инструменты, которые бесполезны без реального агента и только сбивают слабую модель
  toolDeny: (
    process.env.TOOL_DENY ||
    [
      'Agent',
      'Task',
      'Workflow',
      'ExitPlanMode',
      'AskUserQuestion',
      'TodoWrite',
      'WebSearch',
      'WebFetch',
      'NotebookEdit',
      'ListAgents',
      'SendMessage',
      'ReportFindings',
      'ScheduleWakeup',
      'Skill',
      'ToolSearch',
      'DeferredToolPlaceholder',
    ].join(',')
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  verbose: bool(process.env.VERBOSE, false),
  keepDialog: bool(process.env.KEEP_DIALOG, false),
};

module.exports = config;
