---
name: codewith-code-style
description: CodeWith의 Vue·JavaScript·CSS 작성과 리뷰에 Vue 공식 스타일 가이드와 프로젝트 Prettier 형식을 적용한다. 컴포넌트·props·이벤트·템플릿·네이밍·포맷의 구체적인 기준과 기존 코드에 적용하는 범위를 제공한다.
---

# Vue 공식 스타일 가이드 + Prettier

## 기준과 적용 범위

- Vue 공식 스타일 가이드의 A(필수)·B(강력 권장)를 기본으로 삼고, C(선택 가능한 일관성)는 아래 프로젝트 선택을 따른다. D(주의 필요)는 기존 설계 경계를 확인한 뒤 사용한다.
- 현재 Vue 3 Composition API와 `<script setup>`, JavaScript ES modules를 유지한다. 공식 문서의 Options API 예시를 적용하려고 API 방식을 되돌리거나 TypeScript를 도입하지 않는다.
- 공백·따옴표·개행 등 기계적 형식의 원본은 프로젝트 루트 `.prettierrc.json`이다. 규칙 간 포맷 충돌은 Prettier 출력에 맞춘다. Vue 의미 규칙은 포맷터가 검사하지 않으므로 직접 검토한다.
- 새 코드와 수정하는 코드를 이 기준으로 작성한다. 기존 파일 전체의 리네이밍·구조 변경·일괄 포맷은 별도 작업으로 분리한다. 이 스킬 도입 자체가 기존 코드 전체의 준수를 보장하지는 않는다.

## 컴포넌트와 파일

- 컴포넌트는 한 SFC에 하나를 두고, 두 단어 이상의 `PascalCase.vue` 이름을 사용한다. 루트 `App.vue`는 예외다. SFC 템플릿의 프로젝트 컴포넌트도 PascalCase로 작성한다.
- 기존 공통 컴포넌트의 `Cw` 접두사를 유지한다. Vuetify의 전역 `v-app`·`v-btn`·`v-select`는 현재 등록 방식을 따른다. 이름만 통일하려고 래퍼를 새로 만들지 않는다.
- 자식 전용 컴포넌트는 기능 관계가 드러나게 이름을 짓는다. `RequirementCard`, `PlanPanel`, `WorkspaceSidebar`처럼 역할을 명확히 한다.
- SFC 순서는 `<script setup>` → `<template>` → `<style scoped>`를 기본으로 한다. 스크립트가 없는 정적 안내 컴포넌트에 빈 블록을 추가하지 않는다.
- composable은 `useFeature.js`, 함수·변수·JS prop 이름은 camelCase로 작성한다. 기존 서버·공유 모듈의 `.mjs` 구분을 유지한다.

## props·이벤트·상태

- JavaScript `defineProps`는 최소한 타입을 명시하고, 필수 여부·기본값·검증 조건은 실제 계약에 맞춘다. 배열·객체 기본값은 새 값을 반환하는 함수를 사용한다.
- props 및 전달받은 객체를 일반 자식 컴포넌트에서 임의로 수정하지 않는다. `defineEmits`로 이벤트를 선언해 부모에게 변경을 알리거나 명시적인 `v-model` 계약을 사용한다.
- 기존 `useEditors`의 공유 초안처럼 변경 권한이 설계된 객체는 해당 composable의 계약을 따른다. 규칙 적용을 이유로 복사본을 만들어 저장·dirty 추적을 끊지 않는다.
- 이벤트 선언/emit 이름은 camelCase, 템플릿 리스너는 kebab-case를 기본으로 한다. `update:modelValue`와 `@update:model-value` 등 프레임워크·기존 공개 계약은 유지한다.
- 파생값은 computed, 외부 동기화 같은 부수효과는 watch/수명 주기에 둔다. computed 안에서 상태를 변경하거나 요청을 시작하지 않는다. 이벤트·타이머·에디터 해제도 같은 기능 경계에서 관리한다.

## 템플릿

- `v-for`에는 항목의 안정적인 식별자로 `:key`를 준다. 재정렬·추가·삭제되는 목록의 인덱스를 식별자로 쓰지 않는다.
- 같은 요소에 `v-if`와 `v-for`를 함께 쓰지 않는다. 필터링한 computed 목록이나 바깥 조건 블록을 사용한다.
- 복잡한 조건·문자열 조합은 이름 있는 computed/함수로 추출한다. 템플릿에서는 표시와 이벤트 연결이 읽히게 한다.
- `:prop`, `@event`, `#slot` 축약을 일관되게 사용한다. 전달하는 prop/HTML 속성 이름은 kebab-case로 쓴다.
- 콘텐츠 없는 Vue 컴포넌트는 self-closing, 콘텐츠가 있는 일반 HTML 요소는 닫는 태그를 명시한다. 속성값은 따옴표로 감싼다.
- 속성은 역할이 보이도록 구조 지시자·key/ref → 식별/정적 속성 → 바인딩/모델 → 이벤트 순으로 모은다. `v-bind`와 명시적 prop의 우선순위를 바꾸는 정렬은 하지 않는다.
- `<table>`의 `thead`/`tbody`처럼 올바른 HTML 구조를 사용한다. Vue 컴파일 경고를 숨기지 않는다.
- `h` 기반 동적 폼, 정적 안내의 `v-pre`, 정제된 Markdown/SVG, ProseMirror 내부 DOM은 기존 구조의 명시적 사용처다. 스타일 정리만으로 이 경계를 재구현하지 않는다.

## CSS와 가독성

- 컴포넌트 전용 스타일은 scoped 또는 충돌하지 않는 클래스 범위로 제한한다. 공통 토큰·테마·Vuetify 호환 규칙은 기존 `src/styles/`에서 관리한다.
- scoped 안에서도 광범위한 태그 선택자보다 목적이 드러나는 클래스를 우선한다. 라이브러리 내부 요소는 필요한 범위의 `:deep()`으로 제한한다.
- 기존 색상·간격 토큰을 재사용한다. 같은 목적의 CSS 규칙을 파일 끝에 계속 중복 추가하지 않는다.
- 사용자 문구는 한국어, 코드 식별자는 영어로 작성한다. 주석은 코드가 이미 보여 주는 동작보다 이유·제약을 설명한다.

## Prettier 형식과 사용

- 들여쓰기 2칸, 공백 사용, 세미콜론, 큰따옴표, trailing comma `all`, 화살표 매개변수 괄호 `always`.
- 줄 너비 80은 포맷터의 목표값이다. URL·문자열을 강제로 잘라 의미를 바꾸지 않는다.
- UTF-8·LF로 저장한다. Vue script/style 본문에 추가 들여쓰기를 넣지 않고, 여러 속성은 속성별 줄로 배치한다.
- `htmlWhitespaceSensitivity: css`를 유지한다. 보기 좋은 태그 정렬을 위해 인라인 요소 사이의 의미 있는 공백을 바꾸지 않는다.
- 프로젝트에 설치된 Prettier를 사용한다. 자동 업그레이드나 별도 전역 버전에 의존하지 않는다.

프로젝트 루트에서 변경한 파일을 지정한다:

```sh
./node_modules/.bin/prettier --write src/components/ExampleCard.vue
./node_modules/.bin/prettier --check src/components/ExampleCard.vue
```

`.prettierignore`는 실제 데이터·비밀 파일·생성물·Claude 연결 디렉터리를 제외한다. 스킬은 `.agents/skills/` 원본을 포맷한다. 전체 상태는 `npm run format:check`로 확인한다. 전체 정리가 요청된 경우 `npm run format`을 사용한다 (`prettier --write .`).

포맷 확인과 기능 검증은 구분한다. JS 문법은 `npm run check`, Vue 템플릿은 `npm run build`, 동작 변경은 관련 테스트로 확인한다. 현재 ESLint나 자동 포맷 CI는 없으므로 이 스킬에 적힌 의미 규칙이 자동 검사된다고 설명하지 않는다.

## 공식 참고

- [Vue 스타일 가이드](https://vuejs.org/style-guide/): A·B 기준과 C·D 선택의 근거.
- [Vue script setup](https://vuejs.org/api/sfc-script-setup.html), [props](https://vuejs.org/guide/components/props.html), [events](https://vuejs.org/guide/components/events.html): 현재 Composition API 적용 방식.
- [Prettier 옵션](https://prettier.io/docs/options): 포맷 옵션의 의미. 구체적인 프로젝트 값은 `.prettierrc.json`을 따른다.
