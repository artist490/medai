# Tech Debt Audit — medai (Спектр-Диагностика)

Generated: 2026-11-15 · branch `clinic` · HEAD `2a4213a` · ~6.2k LOC (backend 3.5k py, frontend 4.9k ts/tsx)
Method: full-repo sweep across 9 dimensions; backend read end-to-end, frontend по churn-пересечению. Инструменты: pytest (139 passed, 2:50), ruff (21), mypy (3), npm audit (2 moderate), TestClient-эксперимент загрузки документов.

---

## Run 2 — 2026-11-15 (повтор-режим, фикс-заход по итогам Run 1)

**Состояние: 141 тест passed · ruff чист · mypy чист · фронтенд собирается.** Закрыто **26 из 34** находок:

- **RESOLVED:** F001, F002, F003, F004, F005, F006, F008, F009, F010, F011, F012, F013, F014, F015, F016, F017, F018, F019, F022, F023, F024, F025, F026, F027, F029, F030, F031, F033 — фиксация: `services/payloads.py` + `services/signals.py` (единый слой ответов и сигналов), `MedCard.tsx` → `pages/medcard/*` (7 файлов), N+1 → CTE с `ROW_NUMBER` и `GROUP BY`, rate-лимит чата + тест, `request()` в api.ts не ставит Content-Type для FormData, индексы (`INDEXES_SQL`), CI в `.github/workflows/ci.yml`.
- **Попутно найдено и починено при разделении MedCard:** двойной рендер `RiskSystems` на вкладке «Обзор» (дубль-блок строк 508-512 старого файла).
- **Остались открыты:** F007 (ключи опросника едины в бэкенде, фронтенд-копия ждёт API-эндпоинта), F020 (13 явных commit — workaround осознанный), F021 (react-router 7 — breaking, по плану), F028 (visit_date в прошлом — вопрос), F032 (пороги в JSON — опционально), F034 (приватность ИИ-сводки — вопрос политики клиники).

Оригинальный отчёт Run 1 ниже без изменений — таблица служит историческим контекстом.

---

## Executive summary

- **1 Critical, 2 High, 19 Medium, 12 Low.** Ядро (auth, БД, правила, гварды филиалов) крепкое — долг концентрируется во «втором эшелоне»: документы, чат, god-файлы фронта.
- **Critical F001 — загрузка документов мёртвая из UI:** `request()` в api.ts всегда ставит `Content-Type: application/json`, multipart-тело теряется → FastAPI отвечает 422. Воспроизведено на TestClient (без заголовка — 201, с ним — 422). Бэкенд при этом работает.
- **High:** чат с платным LLM без rate-лимита (F002); загрузка документа читает весь файл в память до проверки размера (F003).
- **Горячая зона churn × size:** MedCard.tsx (727 LOC, 8 компонентов, 29 useState, 21 правка theme.css рядом), doctor.py (496 LOC, N+1 в пуле).
- Статика: mypy — 3 ошибки, ruff — 21 (5 автоделаются), npm audit — 2 moderate (react-router, SSR-вектор, SPA не затронут).
- Документация отстала от v2 на 6 групп эндпоинтов и на число тестов (README: 124, факт: 139).
- Нет CI — 139 герметичных тестов и линтеры запускаются только вручную.
- Конвенции времени смешаны: naive-local в замерах/приёмах vs UTC-ISO в сессиях (F012).
- Несколько «выглядит плохо, но всё ок» проверены и оправданы (динамический SQL — только из Pydantic-белистлистов; BLOB-документы; in-memory брутфорс-гвард).

## Architectural mental model

Монолит «один процесс»: FastAPI + SQLite (WAL) без ORM — роутеры пишут сырой SQL через `get_db`/`db_session` (yield-зависимость с commit/rollback), сервисы — `rules.py` (детерминированная экспертная система порогов ВОЗ/ESC/ESH, не зависит от LLM), `llm.py` (OpenAI-совместимый адаптер к PlusVibe с честной деградацией в None), `chat_agent.py` (function calling, инструменты читают только данные текущего пользователя/филиала), `analyze.py` (оркестратор: правила → риск → опциональное LLM-обогащение; LLM не меняет риск). Авторизация: pbkdf2 ×200k, bearer-сессии в БД, роли patient/doctor, гвард филиала `branch_id IS ?` пронизывает все врач-эндпоинты. Приглашение врача — одноразовые коды через `tools/make_invite.py`.

Фронтенд: React 18 + TS (strict) + Vite + Tailwind 4 поверх 846-строчного theme.css с токенами «Клинический свет». Один fetch-обёрточный api.ts (bearer в localStorage, 401 → сброс), auth-контекст, маршруты с клиентскими гвардами RequireAuth/RequireDoctor, брендинг в brand.ts. Прод: бэкенд раздаёт собранный dist с SPA-fallback (path-traversal гвард на месте).

README не противоречит модели — но описывает репо до функциональности v2 (дневник/цели/документы/сигналы/аналитика появились в `2a4213a` и в README не вошли).

## Findings

| ID | Category | File:Line | Severity | Effort | Description | Recommendation |
|----|----------|-----------|----------|--------|-------------|----------------|
| F001 | Contract bug | frontend/src/api.ts:24, api.ts:259 | Critical | S | `request()` всегда ставит `Content-Type: application/json`; `uploadDocument` шлёт FormData с JSON-заголовком → 422 «Field required» (воспроизведено: без заголовка 201, с ним 422) | В `request()` не ставить Content-Type, когда `options.body instanceof FormData` |
| F002 | Cost/abuse | backend/app/routers/chat.py:23 | High | S | `/api/chat/send` без лимитов: каждый вызов = платный LLM-запрос до 6 раундов инструментов; спам не ограничен | Клонировать брутфорс-гвард из routers/auth.py:19-33 по user_id (напр. 20 запросов/час) |
| F003 | Resource | backend/app/routers/documents.py:35 | High | S | `file.file.read()` читает весь файл в память ДО проверки размера — 2 ГБ UploadFile лягут в RAM | `data = file.file.read(MAX_SIZE + 1)`; если длина > MAX_SIZE → 422 |
| F004 | Performance | backend/app/routers/doctor.py:65 | Medium | M | N+1: на каждого пациента 3 запроса в цикле (замеры ×100, анкета, счётчик визитов); 200 пациентов = 600+ запросов на GET /patients | 3 групповых запроса с GROUP BY/подзапросами, собрать в Python |
| F005 | Performance | backend/app/routers/analytics.py:41 | Medium | S | Ряд за 14 дней строится 14 отдельными COUNT-запросами в цикле | Один `GROUP BY date(recorded_at)` за период |
| F006 | Layering | backend/app/routers/doctor.py:12 | Medium | M | Роутеры импортируют друг у друга payload-хелперы и приватный `_visit_payload` из visits.py — сцепление роутеров | Вынести `analysis_payload`/`measurement_payload`/`_visit_payload`/`VISIT_SELECT` в `app/services/payloads.py` |
| F007 | Consistency | backend/app/routers/doctor.py:36 | Medium | M | `ALARM_SURVEY_KEYS` продублирован с `ALARM_KEYS` в AnamnesisSurvey.tsx; комментарий признаёт ручную синхронизацию — рассинхрон даст тихую потерю сигналов | Один источник: отдавать ключи API (`/api/medcard/alarm-keys`) или генерить типы из схемы |
| F008 | Arch decay | frontend/src/pages/MedCard.tsx:272 | Medium | M | God-файл: 727 LOC, 8 компонентов (AnamnesisForm, BookingMenu, VisitForm, VisitCard, PressureDiary, GoalsEditor, DocumentsTab, MedCard), 29 useState | Разнести компоненты по файлам `pages/medcard/*` — каждый уже самодостаточен |
| F009 | Type debt | backend/app/auth.py:103 | Medium | S | mypy: 3 ошибки — `create_session(cursor.lastrowid: int\|None)` (auth.py:103), `values: list[str]` с int (visits.py:114), нет аннотации `tools_used` (chat.py:45) | Аннотировать: `int(cursor.lastrowid)` после проверки, `list[str \| float]`, `tools_used: list[str]` |
| F010 | Correctness | backend/app/services/llm.py:125 | Medium | S | `content.lstrip("json")` / `lstrip("markdown")` (llm.py:87) срезают по МНОЖЕСТВУ символов — ответ, начинающийся с букв j/s/o/n/m/a/r/k/d/w, потеряет начало | `if content.startswith("```"): content = content.split("\n", 1)[-1].strip("`")` или удалять только известный префикс |
| F011 | Config debt | backend/app/config.py:13 | Medium | S | Дефолты config.py (`gpt-4o-mini`, `api.openai.com`) противоречат .env.example (`deepseek-v4.1-flash-1017`, `plusvibeapi.ru`): вписал только ключ → запрос ушёл в OpenAI | Синхронизировать дефолты config.py с .env.example (PlusVibe/deepseek) |
| F012 | Consistency | backend/app/routers/measurements.py:103 | Medium | S | Смешанные конвенции времени: naive-local `datetime.now()` в замерах/приёмах/визитах vs `timezone.utc` ISO в сессиях (auth.py:44, database.py:231) | Зафиксировать конвенцию (дневник — местное время, серверные метки — UTC) в комментарии config.py; при выезде за DST — пересмотреть |
| F013 | Consistency | backend/app/routers/analytics.py:32 | Medium | S | `requires_attention` в analytics = только `last_risk=="red"`, а в doctor.py:104 — red ИЛИ тревожный опросник: одно имя поля, разные семантики | Выровнять семантику или переименовать поле в analytics (`has_red`) |
| F014 | Arch decay | frontend/src/assets/icons/*.png | Medium | S | 34 PNG-иконки не упоминаются ни в tsx, ни в CSS (grep: 0 ссылок) — мёртвые ассеты + мёртвый генератор tools/slice_icons.py (189 LOC) | Удалить папку и генератор (иконки заменены SVG в components/Icon.tsx) |
| F015 | Doc drift | README.md:121 | Low | S | README: «124 теста», фактически 139 passed | Обновить число или формулировку «130+» |
| F016 | Doc drift | README.md:154 | Medium | S | Таблица API не содержит 6 групп v2: goals, documents, analytics, stats, doctor/signals, doctor/analyses/{id}/seen, measurements/repeat | Дополнить таблицу API |
| F017 | Doc drift | README.md:138 | Low | S | Дерево структуры не упоминает routers/goals, documents, analytics | Обновить дерево |
| F018 | Duplication | backend/app/routers/measurements.py:108 | Medium | S | create_measurement и repeat_last_measurement дублируют блок INSERT→analyze→INSERT analyses (~25 строк ×2, включая json.dumps llm_text) | Хелпер `_insert_and_analyze(db, user, values, recorded_at, period)` |
| F019 | Consistency | backend/app/routers/documents.py:54 | Low | S | `SELECT last_insert_rowid()` вместо `cursor.lastrowid`, как в measurements.py:112 | Унифицировать на cursor.lastrowid |
| F020 | Design | backend/app/routers/auth.py:106 | Medium | M | 13+ явных `db.commit()` в роутерах, каждый с комментарием «см. комментарий в routers/auth.py register» — workaround teardown-коммита размазан по файлам | Коммитить внутри get_db до возврата ответа (финализатор после yield уже поздно) → helper `save(db)` или оставить, но свести комментарии к одному |
| F021 | Dep debt | frontend/package.json:14 | Medium | M | react-router-dom 6.28: GHSA-337j-9hxr-rhxg (moderate, deserializeErrors в SSR-гидрации); `npm audit fix --force` ставит 7.x — breaking | Запланировать апгрейд на react-router-dom 7 (API совместим на 90%) |
| F022 | Test debt | backend/tests | Low | M | Чат-агент покрыт (test_chat 6, test_llm 8), но нет теста на «модель зациклилась на инструментах» (chat_agent.py:302-311 — ветка без tool_calls после 6 раундов) | Один тест с моком 6 tool_calls подряд |
| F023 | Tooling | .github/workflows (нет) | Medium | M | Нет CI: 139 герметичных тестов, ruff и mypy запускаются только вручную | GitHub Actions: pytest + ruff + mypy на PR (шаблон из revizor) |
| F024 | Style | backend/app/services/rules.py:53 | Low | S | ruff 21: 5×F401 (auth.py:4,12; chat.py:4; documents.py:8; analyze.py:3), 2×F841 (rules.py:46 sys_, dia_), 14×E701 (rules.py:53-68) | `ruff --fix` для F401; для E701 — noqa с комментарием «пороговая лестница как в таблице» или развернуть |
| F025 | Observability | backend/app/routers/chat.py:45 | Low | S | Fallback-текст при недоступности LLM один на все причины: нет ключа / сеть / баланс — пациент не отличит | Возвращать причину из chat_completion (тип исключения) и варьировать текст |
| F026 | UX data | frontend/src/components/Layout.tsx:47 | Low | S | Счётчик сигналов врача обновляется только при изменении значения — новый красный замер не появится, пока что-то не изменится | Refetch по setInterval(60с) или на смену маршрута |
| F027 | API | frontend/src/api.ts:41 | Low | S | `body.detail` может быть массивом (FastAPI 422 validation) → Error-message «[object Object]» | `Array.isArray(detail) ? detail.map(d=>d.msg).join('; ') : detail` |
| F028 | Validation | backend/app/routers/visits.py:38 | Low | S | `visit_date` проверяется только regex — запись приёма на прошедшую дату допустима | Если backfill осознан — комментарий; иначе `date.fromisoformat(...) >= today` |
| F029 | Schema | backend/app/schemas.py:40 | Low | S | `recorded_at: Optional[str]` без max_length — мегабайтная строка дойдёт до fromisoformat | `Field(default=None, max_length=64)` |
| F030 | Performance | backend/app/routers/doctor.py:309 | Low | S | complete_visit: два SELECT (id, затем status) подряд | Один `SELECT id, status FROM visits WHERE id = ?` |
| F031 | Dep debt | backend/requirements.txt:7 | Low | S | pytest в продовом манифесте | requirements-dev.txt или `[project.optional-dependencies]` |
| F032 | Arch decay | backend/app/services/rules.py (338 LOC) | Low | L | Медицинские пороги захардкожены в коде — правка норм требует релиза кода; 38 тестов страхуют, но таблица в README может разойтись | Опционально: пороги в JSON-данные с загрузкой; сейчас — приемлемо |
| F033 | Security | backend/app/routers/auth.py:21 | Low | S | `_LOGIN_FAILS` растёт неограниченно по ключам email\|IP; за прокси request.client.host — один IP для всех | Cap на размер dict (чистка старых); при деплое за nginx — реальный IP из заголовка (доверенного) |
| F034 | Privacy | backend/app/services/llm.py:69 | Medium | S | `patient_summary` отправляет наружу (PlusVibe) имя, возраст, анамнез, жалобы и заключения врачей — при каждом нажатии врачом | Маскировать имя («Пациент N, 58 лет») и/или согласовать с политикой клиники; ключ уже опционален — это правильно |

## Top 5 — «если чинить только это»

1. **F001 — починить загрузку документов (S).** Фича мёртвая из UI. Диф:
   ```ts
   // api.ts request()
   const headers: Record<string, string> = {
     ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
     ...(options.headers as Record<string, string>),
   }
   ```
   Плюс тест на TestClient с multipart-заголовком в обе стороны (репро уже написано).
2. **F003 — кап чтения файла (S).** Одна строка: `file.file.read(MAX_SIZE + 1)` — снимает RAM-риск до прикручивания лимита тела сервера.
3. **F002 — rate-лимит чата (S).** Скопировать паттерн `_LOGIN_FAILS` на user_id: 20/час достаточно для ассистента, защищает баланс PlusVibe.
4. **F008 — разрезать MedCard.tsx (M).** Самое churn-ное место фронта (21 правка theme.css + 7 правок MedCard за полгода — каждый новый элемент v2 дописывался в один файл). 7 компонентов уже чётко очерчены — перенос без изменения логики.
5. **F004 + F005 — групповые запросы вместо циклов (M).** GET /patients — самый частый врач-эндпоинт; при росте филиала N+1 станет заметен первым. SQL уже написан в chat_agent._exec_patients_overview (там же по подзапросам) — переиспользовать подход.

## Quick wins

- [ ] F001: не ставить Content-Type для FormData (одна строка + тест)
- [ ] F003: `read(MAX_SIZE + 1)` (одна строка)
- [ ] F002: клон login-гварда на /chat/send (~15 строк)
- [ ] F010: заменить `lstrip("json")`/`lstrip("markdown")` на split по ``` (2 строки)
- [ ] F011: дефолты config.py = .env.example (2 строки)
- [ ] F024: `ruff --fix` (5 F401 авто) + noqa на E701-лестницу
- [ ] F019: last_insert_rowid() → cursor.lastrowid
- [ ] F029: max_length на recorded_at
- [ ] F030: слить два SELECT в complete_visit
- [ ] F031: pytest → requirements-dev.txt
- [ ] F015/16/17: README — число тестов, таблица API, дерево структуры
- [ ] F014: удалить 34 мёртвых PNG + tools/slice_icons.py

## Things that look bad but are actually fine

- **Динамический SQL через f-строки** (`UPDATE users SET {sets}` auth.py:154, `{columns}` measurements.py:109/172, visits.py:115): выглядит как инъекция, но имена колонок всегда приходят из `model_dump()` Pydantic-моделей со строгими Literal/диапазонами — набор ключей фиксирован схемой, значения всегда через `?`. Проверено: ProfileIn (schemas.py:20-25) не содержит role/email/пароля. Оставить как есть.
- **`except Exception` вокруг инструментов чата** (chat_agent.py:292): намеренный барьер «инструмент не должен ронять чат», с логом. Проброс сюда исключений сделал бы ассистента хрупким.
- **`db_session`: rollback + `raise`** (database.py:207-209): широкая ловушка, но исключение не глотается — пробрасывается наверх в 500. Корректно.
- **`check_same_thread=False`** (database.py:193): соединение живёт в пределах одного запроса, комментарий объясняет teardown-нюанс uvicorn. Не межзапросный шаринг.
- **BLOB-документы в SQLite** (documents.py:1-6): осознанный выбор для локального деплоя клиники, docstring это фиксирует; 8 МБ кап + whitelist MIME (SVG не пущен — inline-XSS нет).
- **In-memory брутфорс-гвард логина** (routers/auth.py:16-21): ограничение задокументировано в комментарии («при масштабировании — Redis»); для локального деплоя клиники достаточно. Сброс при рестарте — приемлемо.
- **npm audit: 2 moderate в react-router** — вектор через `deserializeErrors()` в SSR-гидрации; проект — чистый Vite-SPA без SSR, класс уязвимости неприменим. Апгрейд на 7.x — по плану (F021), не аварийно.
- **pytest 2:50 на 139 тестов** — это не «медленные тесты», а честный pbkdf2×200k в тестах реальной регистрации/логина: фидельность важнее секунд.
- **theme.css 846 LOC** — единый файл токенов/компонентов «Клинического света»; churn (21 правка) — это итерации дизайна, не распад. Резать на модули стоит только при появлении второго разработчика.
- **E701 в rules.py:53-68** — «лестницы» порогов (`if v < 120: return 0`) зеркалят клиническую таблицу 1:1 и в таком виде читаются лучше развёрнутых блоков. Осталось оформить noqa (F024), а не переписывать.
- **Явные `db.commit()` перед ответом** (F020) — сам workaround правильный и необходимый (yield-финализатор FastAPI выполняется после отправки ответа); долговат только способ его распространения — 13 перекрёстных комментариев.

## Open questions for the maintainer

1. **Документы пациента врач не видит** — endpoints /api/documents работают только со своими (documents.py:77). Это осознанная приватность или упущение v2? Для приёма врачу могут понадобиться результаты исследований.
2. **`visit_date` в прошлом** (F028) — бэкфилл записей или нужен запрет?
3. **ИИ-сводка и личные данные** (F034) — какое требование у клиники: отправлять имя пациента во внешний API или маскировать?
4. **Целевой LLM-провайдер** (F011) — дефолты должны указывать на PlusVibe или на OpenAI? От этого зависит, что чинить: config.py или .env.example.
5. **Сигналы врача** (F026) — нужен ли real-time (polling/SSE) или «обновилось при переходе» достаточно для приёма?
6. **CI** (F023) — поднимать GitHub Actions на PR? Тесты герметичны, сетки не требуют — готов за один заход.
