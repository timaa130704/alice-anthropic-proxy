# alice-anthropic-proxy

Локальный шлюз: **Anthropic Messages API** → **Алиса AI** (web-протокол `uniproxy`).

Клиент думает, что говорит с `api.anthropic.com`. На деле запрос уходит в websocket
Алисы, а ответ приезжает обычными SSE-событиями `text_delta`.

```
клиент ──POST /v1/messages──▶ proxy ──wss://uniproxy.alice.yandex.net/uni.ws──▶ Алиса
        ◀──SSE text_delta──        ◀── base_response.cards[].text_card / neuro_structured_blocks ──
```

## Что умеет

- `POST /v1/messages` — стрим (`stream:true`, SSE как у Anthropic) и обычный JSON
- `POST /v1/messages/count_tokens` — грубая оценка по символам
- `GET /v1/models` — список алиасов моделей
- `GET /health` — статус и режим авторизации
- Эмуляция tool use (`TOOL_EMULATION=true`): модель просят вернуть `<tool_use>{...}</tool_use>`,
  прокси превращает это в настоящий блок `tool_use` + `stop_reason: "tool_use"`
- Анонимный режим (без cookie) и режим со своими cookie Яндекса

## Быстрый старт

```powershell
cd C:\Users\zeiss\alice-proxy
copy .env.example .env      # при желании вписать ALICE_COOKIE
npm start                   # http://127.0.0.1:8787
```

Проверка:

```powershell
curl http://127.0.0.1:8787/health

curl http://127.0.0.1:8787/v1/messages ^
  -H "content-type: application/json" ^
  -d "{\"model\":\"alice-ai\",\"max_tokens\":1024,\"messages\":[{\"role\":\"user\",\"content\":\"привет\"}]}"
```

## Подключение клиентов

Claude Code (проверено на 2.1.319):

1. `npm i -g @anthropic-ai/claude-code`
2. Пропиши в `C:\Users\zeiss\.claude\settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:8787",
    "ANTHROPIC_AUTH_TOKEN": "alice-local",
    "ANTHROPIC_MODEL": "claude-sonnet-4-5-20250929",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-5-20250929",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-sonnet-4-5-20250929",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "DISABLE_AUTOUPDATER": "1"
  }
}
```

Модель называется `claude-sonnet-4-5-20250929` только чтобы Claude Code не ругался
на неизвестное окно контекста — прокси игнорирует `model` в теле запроса.

3. Запуск: `claude-alice.cmd` (поднимет прокси, если он лежит, и откроет Claude Code).
   Или вручную — сначала `node src/index.js`, потом `claude`.

Anthropic SDK (python):

```python
from anthropic import Anthropic
c = Anthropic(base_url="http://127.0.0.1:8787", api_key="local")
print(c.messages.create(model="alice-ai", max_tokens=512,
      messages=[{"role": "user", "content": "кто ты?"}]).content[0].text)
```

## Cookie (свой аккаунт)

1. Открой `https://alice.yandex.ru`, залогинься.
2. DevTools → Network → любой запрос к `alice.yandex.ru` → Request Headers → `Cookie`.
3. Скопируй значение целиком в `.env`:

```
ALICE_COOKIE=Session_id=...; sessionid2=...; yandexuid=...; i=...; yandex_login=...
```

Без cookie работает аноним: лимиты ниже, история не сохраняется.

## Как это работает внутри

1. `SynchronizeState` — регистрируем устройство, получаем `SessionId`.
2. `Vins/TextInput` с `dialog_type: 2` (`DEDICATED_CHAT`), `topic: "desktopgeneral"`,
   capability `AliceChatCapability` и `alice_2_settings: { preset: "", mode: "Base" }`.
   Без всего этого сервер уводит запрос в сценарий старой Алисы (`GeneralConversation`)
   и вместо кода отвечает «Это домашнее задание что ли?».
3. Ответ приходит двумя путями:
   - `Vins/DeferredAliceResponse` → `json_response.base_response` с прогрессивной печатью
     (`is_last: true` = конец),
   - `Vins/VinsResponse` → `directives` (`print_text_in_message_view`) или снапшот.
   Текст берём из `text_card.text` либо `neuro_structured_blocks_card.plain_text`.
4. Дельта считается по префиксу: сервер присылает накопленный текст, прокси отдаёт приращение.

### Инструменты (function calling)

Веб-протокол Алисы не умеет нативный function calling, поэтому прокси эмулирует его:

- в начало промпта кладётся протокол `"<tool_use>{\"name\":...,\"input\":{...}}</tool_use>"`,
  список инструментов идёт ужатым (без полных JSON Schema), в конец — напоминание;
- парсер терпимый: принимает `<tool_use>`, ```json-забор, голый объект `{"name":...}`,
  обёртки `{"tool_use":{...}}` / `{"function":{"name":...}}`, достраивает незакрытые
  скобки/кавычки и убирает висячие запятые — слабая модель почти никогда не даёт валидный JSON;
- имя проверяется по списку реально доступных инструментов, так что мусорный JSON
  не превращается в фантомный вызов;
- если вызов оборвался (а Алиса рвёт огромный JSON примерно на 3k символов), прокси
  просит продолжить с места обрыва и склеивает части;
- если вместо вызова модель нарисовала готовый HTML текстом или внутри питоновской
  строки — прокси вытаскивает документ и сам собирает из него `Write`;
- Claude Code присылает ~85k символов системного промпта, поэтому промпт режется
  бюджетом `MAX_PROMPT_CHARS` (история — с начала, последнее сообщение всегда целиком),
  а системный промпт дополнительно урезается `MAX_SYSTEM_CHARS` — иначе модель
  начинает копировать примеры из него вместо работы.

Мета-инструменты (`Agent`, `ListAgents`, `TodoWrite`, `ToolSearch`, ...) по умолчанию
не показываются модели (`TOOL_DENY`) — слабая модель зовёт их не к месту.

## Телеграм-бот

`bot/telegram.js` — бот на long polling, без зависимостей. Поднимает тот же прокси,
поэтому отдельного сервера не нужно.

1. Создай бота у [@BotFather](https://t.me/BotFather): `/newbot`, забери токен.
2. **Для групп обязательно** выключи privacy mode: `/setprivacy` → выбери бота →
   `Disable`. Иначе бот видит только команды и реплаи на себя, а не обычные сообщения.
3. Положи токен в `.env`: `BOT_TOKEN=123456:AA...`
4. Запуск: `start-bot.cmd` (поднимет прокси, если тот лежит) или `npm run bot`.
5. Добавь бота в группу — и пиши `пидорас <что нужно>`.

Поведение:

- триггер — отдельное слово (`BOT_TRIGGER`), регистр любой, `пидорасы` не считается;
- текст после триггера уходит модели как запрос, ответ приходит реплаем;
- помнит последние `BOT_HISTORY` пар реплик в каждом чате отдельно;
- пока думает — показывает «печатает», второй запрос в том же чате получает «погоди, я занята»;
- длинные ответы режет по 3900 символов, чтобы влезть в лимит телеграма.

Характер задаётся файлом `bot/persona.txt` — там строчные буквы, мат и запрет на отказы.
Правь его свободно, код трогать не надо. Проверить без телеграма:

```powershell
node bot/telegram.js --say "привет, как дела"
```

Ограничения, о которых стоит знать:

- Алиса всё равно иногда отказывает и срывается в вежливый тон. Промпт повышает шансы,
  но её фильтры живут на сервере Яндекса, и обойти их из клиента нельзя.
- **Генерация картинок не работает**: на запрос «нарисуй кота» веб-протокол отдаёт только
  ack и пинги, дальше тишина (анонимно картинки недоступны, и карточка с url не приходит).
  Если нужны картинки — это отдельный сервис, не Алиса.
- Бот читает все сообщения в группе, где выключен privacy mode. Если это напрягает —
  оставь privacy включённым и упоминай бота реплаем.

## Переменные окружения

| Переменная | По умолчанию | что делает |
|---|---|---|
| `PORT` / `HOST` | `8787` / `127.0.0.1` | адрес сервера |
| `PROXY_API_KEY` | пусто | если задан — клиент обязан прислать `x-api-key` |
| `ALICE_COOKIE` | пусто | cookie Яндекса |
| `ALICE_UUID` / `ALICE_DEVICE_ID` | генерится | стабильная идентификация устройства |
| `ALICE_MODE` | `Base` | `Base` (бесплатно) или `Pro` (подписка/триал) |
| `ALICE_MODE_PRESET` | пусто | preset из настроек модели |
| `DEFAULT_MODEL` | `alice-ai` | модель по умолчанию для клиента |
| `REQUEST_TIMEOUT_MS` | `180000` | таймаут одного запроса |
| `TOOL_EMULATION` | `true` | эмуляция инструментов |
| `TOOL_DENY` | см. ниже | инструменты, которые не отдаём модели (Agent, Task, ...) |
| `MAX_PROMPT_CHARS` | `16000` | общий бюджет промпта в символах |
| `MAX_SYSTEM_CHARS` | `6000` | сколько оставлять от системного промпта |

| `KEEP_DIALOG` | `false` | продолжать диалог на стороне Алисы |
| `VERBOSE` | `false` | логирование всех ws-кадров в stderr |
| `BOT_TOKEN` | пусто | токен телеграм-бота от @BotFather |
| `BOT_TRIGGER` | `пидорас` | слово, на которое бот отвечает |
| `BOT_HISTORY` | `8` | сколько пар реплик помнить в чате |

## Диагностика

```powershell
$env:VERBOSE="1"; node tools/probe2.js "привет"
```

- `tools/probe2.js` — несколько запросов подряд через клиент, счётчик дельт
- `tools/probe4.js` — эталонная форма запроса, сырые кадры (`DUMP=1`)
- `tools/test-compat.js` — проверка стрима и tool_use через HTTP
- `tools/test-multiturn.js` — проверка, что история из `messages` доезжает
- `tools/test-parse.js` — разбор `<tool_use>` на разных форматах

## Структура

```
src/ws.js         минимальный WebSocket-клиент (нужен Cookie/Origin)
src/protocol.js   константы протокола: features, experiments, capabilities, payload'ы
src/alice.js      соединение, очередь запросов, сбор текста
src/anthropic.js  Anthropic ⇄ Алиса: промпт, tool-эмуляция, SSE-энкодер
src/index.js      http-сервер, роуты, авторизация
src/config.js     .env + дефолты
```

## Ограничения

- Один websocket, запросы сериализуются (uniproxy не любит параллельность на одном стриме).
- Картинки/файлы не передаются — только текст (`[изображение]`).
- `temperature`, `max_tokens`, `stop_sequences` игнорируются: у веб-протокола их нет.
- `tool_use` — не нативный: модель просят вернуть JSON-блок. Работает, но не гарантия;
  при `false` инструменты просто игнорируются и модель отвечает текстом.
- Это веб-протокол, а не официальное API: поля могут поменяться, тогда поможет `probe4.js` + `DUMP=1`.
