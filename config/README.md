# CodeWith 설정 위치

운영 설정은 **환경변수 > 지정한 JSON 파일 > runtime.defaults.json** 순서로 적용합니다. 코드의 기본 동작은 이전과 같습니다. 설정은 시작할 때 읽으며 변경 후 서버를 재시작합니다.

## 서버 운영 설정

`runtime.defaults.json`은 버전 관리하는 기본값입니다. 개인 변경은 `runtime.example.json`을 `runtime.local.json`으로 복사한 뒤 필요한 항목만 지정하세요. 생략한 항목은 기본값을 사용합니다. `runtime.local.json`은 Git에서 제외합니다.

프로젝트 루트의 `.env` 예:

```dotenv
CODEWITH_CONFIG_FILE=./config/runtime.local.json
CODEWITH_PLAN_TIMEOUT_SECONDS=1800
CODEWITH_AI_REQUEST_TIMEOUT_MS=1800000
```

상대 경로는 서버 실행 작업 디렉터리 기준입니다. `npm start`와 `npm run dev`는 프로젝트 루트의 `.env`를 읽습니다. `node server/index.mjs`를 직접 실행하면 `--env-file-if-exists=.env`를 지정하거나 쉘 환경변수를 설정해야 합니다. Java `.properties` 파일 대신 Node/Vue에서 사용하는 JSON과 `.env`를 사용합니다.

전체 계획 제한과 개별 CLI 요청 제한은 별개입니다. 계획의 사용자 답변·세션 재시작 대기 동안은 전체 타이머를 일시 정지합니다. 환경변수의 전체 제한이 기존 사용자 설정에 남은 숨겨진 시간값보다 우선합니다. 실행 중인 작업의 타이머는 소급 변경하지 않습니다.

| JSON 키                     | 환경변수                                |    기본값 | 의미                                              |
| --------------------------- | --------------------------------------- | --------: | ------------------------------------------------- |
| `planTimeoutSeconds`        | `CODEWITH_PLAN_TIMEOUT_SECONDS`         |     1,800 | 전체 계획 실행 제한(초), 작성·검토·수정·평가 합산 |
| `aiRequestTimeoutMs`        | `CODEWITH_AI_REQUEST_TIMEOUT_MS`        | 1,800,000 | Codex·Claude Code 요청 하나의 실행 제한(ms)       |
| `rpcTimeoutMs`              | `CODEWITH_RPC_TIMEOUT_MS`               |    30,000 | Codex RPC 일반 응답 제한(ms)                      |
| `rpcStartTimeoutMs`         | `CODEWITH_RPC_START_TIMEOUT_MS`         |    60,000 | Codex 실행 시작 RPC 제한(ms)                      |
| `rpcLoginTimeoutMs`         | `CODEWITH_RPC_LOGIN_TIMEOUT_MS`         |    45,000 | Codex 로그인 RPC 제한(ms)                         |
| `rpcInterruptTimeoutMs`     | `CODEWITH_RPC_INTERRUPT_TIMEOUT_MS`     |     5,000 | Codex 중지 RPC 제한(ms)                           |
| `cliStartupTimeoutMs`       | `CODEWITH_CLI_STARTUP_TIMEOUT_MS`       |    15,000 | CLI 초기화 제한(ms)                               |
| `cliProbeTimeoutMs`         | `CODEWITH_CLI_PROBE_TIMEOUT_MS`         |    10,000 | CLI 버전 확인 제한(ms)                            |
| `cliShutdownGraceMs`        | `CODEWITH_CLI_SHUTDOWN_GRACE_MS`        |     1,500 | CLI 종료 대기(ms)                                 |
| `modelListTimeoutMs`        | `CODEWITH_MODEL_LIST_TIMEOUT_MS`        |    20,000 | API 모델 목록 조회 제한(ms)                       |
| `claudeOutputMaxChars`      | `CODEWITH_CLAUDE_OUTPUT_MAX_CHARS`      | 6,000,000 | Claude Code 최대 수신 문자 수                     |
| `claudeMaxTokens`           | `CODEWITH_CLAUDE_MAX_TOKENS`            |     8,192 | Claude API 기본 출력 토큰 수                      |
| `researchMaxTokens`         | `CODEWITH_RESEARCH_MAX_TOKENS`          |     4,096 | Claude 외부 조사 출력 토큰 수                     |
| `researchContentTokens`     | `CODEWITH_RESEARCH_CONTENT_TOKENS`      |    10,000 | Claude 문서 읽기 최대 토큰 수                     |
| `researchMaxTurns`          | `CODEWITH_RESEARCH_MAX_TURNS`           |         3 | Claude 외부 조사 최대 반복 수                     |
| `researchMaxToolUses`       | `CODEWITH_RESEARCH_MAX_TOOL_USES`       |         3 | 조사 요청별 검색/읽기 도구 사용 수                |
| `sseHeartbeatMs`            | `CODEWITH_SSE_HEARTBEAT_MS`             |    15,000 | SSE 연결 유지 주기(ms)                            |
| `runPersistDebounceMs`      | `CODEWITH_RUN_PERSIST_DEBOUNCE_MS`      |       300 | AI 실행 기록 저장 지연(ms)                        |
| `flowSweepMs`               | `CODEWITH_FLOW_SWEEP_MS`                |    60,000 | 인증 흐름 정리 주기(ms)                           |
| `documentReadTimeoutMs`     | `CODEWITH_DOCUMENT_READ_TIMEOUT_MS`     |    20,000 | PDF·DOCX 본문 읽기 제한(ms)                       |
| `databaseConnectTimeoutMs`  | `CODEWITH_DATABASE_CONNECT_TIMEOUT_MS`  |    10,000 | DB 연결 제한(ms)                                  |
| `databaseQueryTimeoutMs`    | `CODEWITH_DATABASE_QUERY_TIMEOUT_MS`    |    15,000 | DB 쿼리 제한(ms)                                  |
| `sqliteBusyTimeoutMs`       | `CODEWITH_SQLITE_BUSY_TIMEOUT_MS`       |     5,000 | SQLite 잠금 대기(ms)                              |
| `planPromptMaxChars`        | `CODEWITH_PLAN_PROMPT_MAX_CHARS`        |   400,000 | 최초 계획 입력 최대 문자 수                       |
| `chatPromptMaxChars`        | `CODEWITH_CHAT_PROMPT_MAX_CHARS`        |   400,000 | 일반 채팅 입력 최대 문자 수                       |
| `planReviewPromptMaxChars`  | `CODEWITH_PLAN_REVIEW_PROMPT_MAX_CHARS` | 1,000,000 | 계획 검토·수정 입력 최대 문자 수                  |
| `planFollowupMaxCalls`      | `CODEWITH_PLAN_FOLLOWUP_MAX_CALLS`      |        24 | 계획 질문 후속 요청·재시작 추가 한도              |
| `projectContextMaxBytes`    | `CODEWITH_PROJECT_CONTEXT_MAX_BYTES`    |   100,000 | 프로젝트 코드 전달 예산(UTF-8 bytes)              |
| `projectSearchPreviewChars` | `CODEWITH_PROJECT_SEARCH_PREVIEW_CHARS` |    12,000 | 파일별 검색에 사용하는 앞부분 문자 수             |

값은 모두 양의 정수입니다. 전체 계획 시간은 최소 30초이며 추가 요청 한도는 최대 32회입니다. ms 값은 최대 86,400,000, 전체 계획 초는 최대 86,400, 토큰 수는 최대 1,000,000, 횟수는 최대 100, 그 밖의 크기는 최대 100,000,000입니다. 잘못된 값·알 수 없는 JSON 키는 시작 시 오류로 알립니다. 실제 제공자의 토큰 한도와 별개이며 값을 크게 잡아도 제공자의 한도를 확장하지는 않습니다.

## 공통 정책과 화면 설정

- `shared/config.mjs`: 입력·코드·첨부 크기 제한(`LIMITS`), 인증 정책(`AUTH_POLICY`), AI 기본값(`AI_DEFAULTS`), 계획 기본값/범위(`PLAN_DEFAULTS`, `PLAN_POLICY`). 서버 검증과 화면 입력이 함께 참조합니다. 수정 후 빌드와 서버 재시작이 필요합니다.
- `shared/source-policy.mjs`: 프로젝트 파일 수·개별/전체 크기(`SOURCE_LIMITS`)와 제외 정책. 브라우저·서버 수집이 공유합니다.
- `src/config/ui.js`: 알림·폴링·재연결 주기, 스트리밍 미리보기 시작 길이, 채팅 입력창 크기와 키보드 조절 간격. 수정 후 빌드합니다.
- `server/provider-config.mjs`: 공식 API 주소·버전·웹 도구 식별자. 서버 전용이며 인증 정보는 포함하지 않습니다.
- `shared/plan-workflow.mjs`: 계획 평가 기준과 배점(`PLAN_RUBRIC`). 점수 의미가 바뀌면 rubric 버전도 함께 검토합니다.
- `src/styles/`와 `src/main.js`: 기존 CSS 토큰·Vuetify 테마. 화면별 색상을 운영 환경변수로 복제하지 않습니다.
- `.prettierrc.json`, `vite.config.js`, `package.json`: 포맷·빌드 설정의 기존 원본을 유지합니다.

HTTP 상태 코드, 암호 알고리즘, 파일 시그니처, 프로토콜 버전처럼 구현 계약인 값은 운영자가 임의 조정하는 실행 설정과 구분합니다. 저장 데이터 검증 상한을 줄이면 기존 문서가 거부될 수 있으므로 공통 정책 변경 시 기존 데이터 호환성을 확인하세요.

## 배포·인증·저장소와 사용자 설정

`.env.example`의 기존 `CODEWITH_MODE`, `HOST`, `PORT`, `CODEWITH_ORIGIN`, 인증/SMTP/OIDC, DB, 데이터 경로, 프로젝트 루트 설정은 그대로 사용합니다. CLI 실행 파일은 `CODEWITH_CODEX_BIN`, `CODEWITH_CLAUDE_BIN`으로 지정합니다. CLI 인자가 있는 배포·포트·저장 경로 설정은 CLI 인자가 환경변수보다 우선합니다.

모델·응답 강도·작성자/평가자 구성은 기존 개인 설정, 프로젝트 지침·스킬은 기존 워크스페이스 저장소에 보관합니다. 비밀번호·API 키·토큰을 기본값 JSON이나 브라우저용 설정에 넣지 마세요. 실제 `.env`와 개인 runtime.local.json은 버전 관리에서 제외합니다. 서버 전용 환경변수와 사용자 인증 정보는 프런트에 전달하지 않습니다.

계획의 JSON·필수 섹션·코드 생략·평가 형식 검사 실패는 같은 세션에서 오류 내용을 전달하여 검사에서 지적한 부분을 자동 수정합니다. 수정하지 않은 요구사항은 원문을 보존하고, 검사에서 특정 코드 섹션을 지적하면 해당 섹션만 교체한 뒤 전체 계획을 다시 검증합니다. `planValidationRetries` / `CODEWITH_PLAN_VALIDATION_RETRIES`의 기본값은 2회입니다. 다른 세션은 계속 진행하며, 자동 재작성에도 실패하면 해당 세션만 수동 재시작 대기로 전환합니다. 자동 재작성도 전체 실행 시간과 `planFollowupMaxCalls`에 포함됩니다. 사용자 중지·연결 오류·시간 초과는 자동 재작성 대상이 아닙니다.
