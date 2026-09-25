# CodeWith 작업 기준

이 지침은 `codewith/`에만 적용한다. 다른 프로젝트에 확대 적용하지 않는다.

## 기본 원칙

- 사용자와는 한국어로 소통한다. 변경 내용·검증 결과·남은 한계를 간결하게 알린다.
- 사용자의 최신 명시적 지시를 우선한다. 이미 결정된 선호는 다시 묻지 않고 아래 스킬에서 확인한다.
- 기존 기능·데이터·UX를 유지하며 요청 범위의 작업을 끝낸다. 구현 세부사항은 판단하되, 결과를 바꾸는 필수 정보가 없을 때만 질문한다.
- 현재 코드를 확인한 뒤 수정하고, 재사용할 기준은 한 곳에서 관리한다. 사용자 작업과 실제 데이터를 테스트나 정리 대상으로 삼지 않는다.
- 실행하지 않은 검사나 해결하지 못한 문제를 완료했다고 보고하지 않는다.
- 생성 또는 수정의 범위를 최소한으로 한다. 사용자가 지시한 작업에 대해서 최소한으로 작업을 수행하되 작업이 더 필요할 것으로 판단되는 경우 추가 작업으로 마지막에 사용자에게 안내를 한다.
- Skill은 따로 명령이 있기 전에는 추가하지 않는다. 만약 요청에 의햇 skill을 작성하는 경우 디테일한 skill 대신 범용적인 skill을 작성한다.

## 상황별 스킬

해당 작업을 시작할 때 관련 `SKILL.md`만 읽는다. 여러 상황에 해당하면 함께 적용하되 모든 스킬을 매번 읽지는 않는다. 경로는 이 파일이 있는 프로젝트 루트 기준이다.

| 작업                                         | 지침 원본                                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 코드 작성·포맷·네이밍                        | [.agents/skills/codewith-code-style/SKILL.md](.agents/skills/codewith-code-style/SKILL.md)     |
| Vue·서버 구조, 상태·폼·라우팅·안내 화면 변경 | [.agents/skills/codewith-architecture/SKILL.md](.agents/skills/codewith-architecture/SKILL.md) |
| UI·텍스트·아이콘·테마·반응형 변경            | [.agents/skills/codewith-ui/SKILL.md](.agents/skills/codewith-ui/SKILL.md)                     |
| 버그 재현, 검증, 서버 실행·재시작 문제       | [.agents/skills/codewith-verification/SKILL.md](.agents/skills/codewith-verification/SKILL.md) |
| 미사용 파일 정리, Git 준비, 지침·스킬 관리   | [.agents/skills/codewith-maintenance/SKILL.md](.agents/skills/codewith-maintenance/SKILL.md)   |

설치·실행 명령과 구조 개요는 [README.md](README.md), 실제 명령 정의는 [package.json](package.json)을 기준으로 확인한다.
`CLAUDE.md`는 이 파일을 가져오는 진입점이며, 상황별 규칙을 복사해 두지 않는다.
