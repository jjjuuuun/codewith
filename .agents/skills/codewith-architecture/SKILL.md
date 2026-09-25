---
name: codewith-architecture
description: CodeWith의 Vue 컴포넌트, composable, 폼, 서버 API, 라우팅 또는 안내 문서 구조를 추가하거나 리팩터링할 때 적용한다.
---

# 구조와 책임

- 기본 스택은 Vue 3 + Vite + Vuetify 3, Composition API, Node.js API다. 새 프레임워크·라우터·전역 상태 라이브러리는 실제 필요가 있을 때만 도입한다.
- 기존 기능·키보드 동작·저장 방식·깊은 링크를 유지한다. 사용자 요청으로 제거한 동작은 관성적으로 복구하지 않는다.

## 수정 위치

| 책임                             | 위치                            |
| -------------------------------- | ------------------------------- |
| 안내/워크스페이스 앱 분기        | `src/App.vue`                   |
| 워크스페이스 화면과 패널 배치    | `src/WorkspaceApp.vue`          |
| 화면·재사용 UI                   | `src/views/`, `src/components/` |
| 상태·저장·세션·기능별 로직       | `src/composables/`              |
| 공통 가드를 거치는 사용자 동작   | `src/actions/`                  |
| API·포맷·파일·내보내기           | `src/services/`                 |
| API·저장소·인증                  | `server/`                       |
| 양쪽에서 쓰는 데이터 규칙·라우트 | `shared/`                       |

`useWorkspace.js`는 기능을 연결하는 진입점으로 유지한다. 기능 구현을 계속 모으는 거대 모듈로 되돌리지 않는다.

## 폼과 비동기 동작

- 폼은 Vue 컴포넌트 또는 기존 `h`/field builder로 구성한다. 초안·검증·오류·저장 중 상태는 `useEditors`와 공통 폼 호스트를 따른다.
- 미저장 변경 보호, 중복 저장 방지, 편집기 식별자를 보존한다. 이전 비동기 저장이 나중에 연 폼을 닫거나 다른 워크스페이스를 덮어쓰면 안 된다.
- 클릭을 Vue 이벤트에 연결한다. `data-action`은 기존 동작 식별/검증에 사용하며 document 전역 위임으로 회귀하지 않는다.
- ProseMirror의 DOM 처리는 `RichTextInput.vue`/`src/rich-editor.js` 경계 안에 둔다. 신뢰된 아이콘과 정제된 Markdown 외에 사용자 HTML을 앱 DOM에 직접 삽입하지 않는다. 계획 HTML의 sandbox 경계를 유지한다.
- 서버의 사용자별 인증·AI 연결·권한·저장소 분리를 보존한다. 프런트에서 버튼을 숨기는 것만으로 API 권한 검사를 대체하지 않는다.

## 안내 화면과 라우팅

- 안내는 메인 Vue 앱의 `/guide`, `/guide/deployment`, `/guide/ai`이며 로그인 없이 읽는다. 앱의 도움말 링크는 새 브라우저 탭으로 연다.
- 목록/주소는 `shared/guides.mjs`, 라우트는 `shared/routes.mjs`, 공통 레이아웃은 `src/views/GuideView.vue`, 내용은 `src/views/guides/`에서 관리한다.
- 과거 `/guide.html`, `/deployment.html`, `/ai-guide.html`, `/local-ai.html`과 독립 안내 HTML은 사용자 요청으로 제거했다. 호환 리다이렉트를 임의로 복구하지 않는다.
- 제목·목차 fragment·새로고침·직접 주소 진입을 보존한다. 브라우저와 서버가 같은 라우트를 인식해야 한다.
- `/auth/wait`는 인증 인계용 페이지다. 일반 안내 문서와 달리 로그인 흐름을 검토하지 않고 합치거나 제거하지 않는다.
