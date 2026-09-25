<script setup>
import { t as __t } from "../../i18n/index.js";
</script>
<template>
  <article>
    <p class="eyebrow">{{ __t("운영 안내") }}</p>
    <h1>{{ __t("개인용에서 공유용, 서버 운영까지") }}</h1>
    <p>
      {{
        __t(
          " CodeWith 사용자 ID와 데이터 구조는 동일합니다. 운영 모드는 접속 범위와 로그인 수단을 결정하며 AI 연결은 계정 안에서 별도로 관리합니다. AI 연결 없이도 명세와 계획을 작성할 수 있습니다. ",
        )
      }}
    </p>
    <nav>
      <a href="#personal">{{ __t("개인용") }}</a
      ><a href="#shared">{{ __t("공유용") }}</a
      ><a href="#server">{{ __t("서버 운영") }}</a
      ><a href="#transition">{{ __t("모드 전환") }}</a
      ><a href="#recovery">{{ __t("계정 복구") }}</a>
    </nav>
    <table>
      <thead>
        <tr>
          <th>{{ __t("설정") }}</th>
          <th>{{ __t("접속") }}</th>
          <th>{{ __t("인증") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>{{ __t("personal · 기본값") }}</td>
          <td>{{ __t("실행 PC의 루프백 주소만") }}</td>
          <td>{{ __t("고정 PERSONAL 계정으로 시작") }}</td>
        </tr>
        <tr>
          <td>shared</td>
          <td>{{ __t("실행 PC에 다른 구성원이 접속") }}</td>
          <td>{{ __t("초기 설정 키, 워크스페이스 초대, 개인 로그인 키") }}</td>
        </tr>
        <tr>
          <td>server</td>
          <td>{{ __t("운영 주소로 지속 제공") }}</td>
          <td>{{ __t("로그인 키 기본. 패스키·이메일·OIDC 추가 선택") }}</td>
        </tr>
      </tbody>
    </table>
    <h2 id="personal">{{ __t("1. personal — 설치 후 바로 사용") }}</h2>
    <pre>
cd codewith
npm install
npm start</pre>
    <p>
      {{ __t(" 설정이 없으면 ") }}<code>personal</code>{{ __t("입니다. ")
      }}<code>http://127.0.0.1:4310</code
      >{{ __t("에서 소개 첫 화면을 표시합니다. ")
      }}<b>{{ __t("PERSONAL 계정 카드") }}</b
      >{{
        __t(
          "를 누르면 고정된 계정의 워크스페이스 목록으로 진입하며 계정 선택, 표시 이름 변경, 로그인 수단 설정을 제공하지 않습니다. 예제 워크스페이스는 만들지 않습니다. AI 연결은 워크스페이스의 대화창에서 관리합니다. ",
        )
      }}
    </p>
    <p>
      {{
        __t(
          " 소개 화면에서 PERSONAL 계정 카드를 누르면 PERSONAL 계정으로 세션을 발급합니다. 발급된 세션이 유효하면 새로고침이나 새 탭에서도 현재 주소의 화면을 바로 엽니다. 처음 접속했거나 세션이 만료된 경우에만 소개 화면을 표시하며, PERSONAL 계정으로 진입하면 요청한 워크스페이스·명세·계획 주소를 이어서 엽니다. 외부 IP의 연결, 외부 Host, 전달 프록시 헤더는 거부합니다. personal에서 ",
        )
      }}<code>HOST=0.0.0.0</code
      >{{
        __t(
          "으로 실행하면 시작 오류가 발생합니다. 다른 사람과 공유하려면 모드를 변경하세요. OS 사용자별 격리는 제공하지 않으므로 같은 PC에 접근하는 사용자는 같은 개인 계정으로 사용합니다. ",
        )
      }}
    </p>
    <h2 id="shared">{{ __t("2. shared — 초대해서 함께 사용") }}</h2>
    <p>
      <code>codewith/.env</code>{{ __t("에 다음을 저장하고 재시작합니다. ")
      }}<code>.env.example</code
      >{{ __t("은 예시이며 자동으로 읽지 않습니다. ") }}
    </p>
    <pre>{{
      __t(
        " CODEWITH_MODE=shared PORT=4310 # 기본 HOST는 0.0.0.0. 특정 인터페이스만 사용하려면 HOST 지정. # 도메인으로 접속한다면: # CODEWITH_ORIGIN=https://codewith.example.com",
      )
    }}</pre>
    <ol>
      <li>
        {{
          __t(
            " personal에서 전환하면 기존 개인 작업 데이터를 이어서 사용합니다. 로그인 수단이 없다면 공유용 초기 설정 과정에서 키를 발급합니다. 이미 로그인 수단이 있다면 해당 수단이나 운영자의 복구 키 발급 명령을 사용합니다. ",
          )
        }}
      </li>
      <li>
        {{ __t(" 새 설치라면 실행 화면에 ") }}<code>.codewith/setup-key</code
        >{{
          __t(
            " 파일 위치가 안내됩니다. 실행 PC의 운영자가 이 파일의 초기 설정 키를 읽고 “처음 설정하기”에 입력합니다. 네트워크에서 가장 먼저 접속한 사람에게 자동으로 관리 권한을 주지 않습니다. ",
          )
        }}
      </li>
      <li>
        {{
          __t(
            " 표시 이름을 정하고 발급되는 개인 로그인 키를 다운로드합니다. 초기 설정 키는 한 번만 사용하며 완료 후 폐기됩니다. ",
          )
        }}
      </li>
      <li>
        {{
          __t(
            " 워크스페이스를 만들고 “팀 참여 요청 허용”을 켭니다. 멤버·공유에서 초대 링크를 복사합니다. ",
          )
        }}
      </li>
      <li>
        {{
          __t(
            " 초대받은 사람은 “초대로 참여하기”에서 이름과 초대 코드를 입력합니다. 개인 계정과 키가 생성되고 참여 요청이 등록됩니다. ",
          )
        }}
      </li>
      <li>
        {{
          __t(
            " 워크스페이스 소유자가 요청을 승인하면 멤버에게 해당 프로젝트가 보입니다. 승인 전에는 내용을 조회할 수 없습니다. ",
          )
        }}
      </li>
    </ol>
    <p>
      {{
        __t(
          " 이미 계정이 있다면 새로 만들지 말고 개인 로그인 키로 로그인한 뒤 초대 코드로 참여하세요. 초대 코드는 로그인 키와 다릅니다. 같은 초대 코드로 여러 사람이 참여를 요청할 수 있으며 각자 다른 개인 키를 받습니다. 워크스페이스 소유자가 초대 코드를 재발급하면 이전 코드는 사용할 수 없습니다. ",
        )
      }}
    </p>
    <p>
      {{
        __t(
          " IP로 직접 접속하는 HTTP 공유도 동작합니다. 일반 네트워크에서 인증 정보가 오갈 때는 HTTPS를 적용하세요. CLI 구독 연결의 인증 절차는 서버 위치에 영향을 받을 수 있으므로 ",
        )
      }}<a href="/guide/ai">{{ __t("AI 연결 안내") }}</a
      >{{ __t("도 확인하세요. ") }}
    </p>
    <h2 id="server">{{ __t("3. server — 운영 환경의 인증 수단 선택") }}</h2>
    <pre>
CODEWITH_MODE=server
CODEWITH_ORIGIN=https://codewith.example.com
CODEWITH_AUTH_METHODS=key
HOST=127.0.0.1
PORT=4310</pre>
    <p>
      {{
        __t(
          " HTTPS 역방향 프록시 뒤에서 운영하는 예입니다. 프록시는 원래 Host 헤더를 유지해야 합니다. ",
        )
      }}<code>HOST</code
      >{{
        __t(
          "를 생략하면 server도 모든 인터페이스에서 듣습니다. 서버는 하나의 프로세스로 실행합니다. 다중 인스턴스·분산 로그인 상태 저장은 현재 제공하지 않습니다. ",
        )
      }}
    </p>
    <p>
      {{ __t(" server의 기본 인증은 별도 서비스 설정 없이 가능한 ")
      }}<code>key</code
      >{{
        __t(
          "입니다. “처음 시작하기”에서 표시 이름과 키를 생성합니다. server는 공개 계정 생성을 허용하지만 다른 사람의 워크스페이스는 초대와 승인 없이 볼 수 없습니다. 사내 구성원으로 계정 생성을 제한하려면 인증 방식을 ",
        )
      }}<code>oidc</code
      >{{ __t("만 켜고 조직 인증 서버에서 앱 접근을 제한하세요. ") }}
    </p>
    <h3>{{ __t("패스키") }}</h3>
    <pre>
CODEWITH_AUTH_METHODS=passkey
CODEWITH_ORIGIN=https://codewith.example.com</pre>
    <p>
      {{
        __t(
          " “패스키로 처음 시작하기”에서 기기의 인증 수단을 등록하고 표시 이름을 입력합니다. 다음부터 “패스키로 로그인”을 사용합니다. 등록·인증은 브라우저 WebAuthn과 SimpleWebAuthn 라이브러리로 검증하며 서버에는 공개키를 저장합니다. 기기의 지문·얼굴 정보는 CodeWith가 받지 않습니다. ",
        )
      }}
    </p>
    <p>
      {{
        __t(
          " 패스키는 RP ID(접속 도메인)에 묶입니다. HTTPS와 도메인이 필요하며, 개발 시 ",
        )
      }}<code>{{ __t("http://localhost:포트") }}</code
      >{{
        __t(
          "는 허용합니다. IP 주소용 패스키는 지원하지 않습니다. 도메인을 바꾸기 전에 복구 키를 보관하고 새 도메인에서 같은 계정에 패스키를 다시 추가하세요. 패스키 동기화 여부는 기기의 자격 증명 관리 서비스에 달려 있습니다. ",
        )
      }}
    </p>
    <h3>{{ __t("이메일 인증 코드") }}</h3>
    <pre>
CODEWITH_AUTH_METHODS=email
CODEWITH_ORIGIN=https://codewith.example.com
CODEWITH_SMTP_URL=smtps://USER:PASSWORD@smtp.example.com:465
CODEWITH_MAIL_FROM=CodeWith &lt;no-reply@example.com&gt;</pre>
    <p>
      {{
        __t(
          " 메일 서비스의 SMTP 자격 증명을 설정합니다. 사용자가 이메일을 입력하면 8자리 일회용 코드가 발송됩니다. 유효 시간은 10분이며, 해당 브라우저의 요청과 연결됩니다. 잘못된 입력이 5번을 넘으면 다시 발송해야 합니다. 발송·인증 횟수도 제한합니다. 코드를 인증하기 전에는 계정을 만들지 않습니다. ",
        )
      }}
    </p>
    <p>
      {{
        __t(
          " 인증이 완료된 동일 이메일은 같은 CodeWith 계정을 사용합니다. 기존 키·패스키 계정에 이메일을 추가할 때는 먼저 기존 계정으로 로그인하고 계정 화면에서 이메일을 연결하세요. 이름이나 AI의 이메일이 같다는 이유로 계정을 자동 병합하지 않습니다. ",
        )
      }}
    </p>
    <h3>{{ __t("조직 SSO — OpenID Connect") }}</h3>
    <pre>{{
      __t(
        " CODEWITH_AUTH_METHODS=oidc CODEWITH_ORIGIN=https://codewith.example.com CODEWITH_OIDC_ISSUER=https://login.example.com/realms/company CODEWITH_OIDC_CLIENT_ID=codewith CODEWITH_OIDC_CLIENT_SECRET=조직_앱_시크릿 CODEWITH_OIDC_LABEL=회사 계정",
      )
    }}</pre>
    <p>
      {{ __t(" 인증 서버에 CodeWith 웹 클라이언트를 등록하고 콜백을 정확히 ")
      }}<code>https://codewith.example.com/api/auth/oidc/callback</code
      >{{
        __t(
          "으로 지정합니다. 클라이언트 인증 방식과 시크릿은 조직의 OIDC 앱 설정에 맞게 준비합니다. 공개 클라이언트라면 시크릿을 생략할 수 있습니다. ",
        )
      }}
    </p>
    <p>
      {{
        __t(
          " 표준 discovery, Authorization Code + PKCE(S256), state, nonce 및 ID 토큰 검증을 openid-client 라이브러리로 수행합니다. 사용자 식별은 검증된 issuer와 subject 조합을 사용합니다. 이메일 문자열만으로 계정을 병합하지 않습니다. 현재 SAML, 조직 권한 자동 동기화, 전역 SSO 로그아웃은 지원하지 않습니다. ",
        )
      }}
    </p>
    <h3>{{ __t("여러 수단을 함께 사용") }}</h3>
    <pre>CODEWITH_AUTH_METHODS=key,passkey,email,oidc</pre>
    <p>
      {{
        __t(
          " 활성화한 수단에 필요한 설정이 빠지면 서버가 오류를 내고 시작을 중단합니다. 조용히 다른 인증 방식으로 바꾸지 않습니다. 설정한 로그인 버튼만 표시됩니다. 기존 계정에서 로그인 수단을 추가하면 같은 사용자 ID를 유지합니다. 로그아웃 상태에서 새 패스키나 새 이메일로 시작하면 별도 계정이 생성될 수 있습니다. ",
        )
      }}
    </p>
    <h2 id="transition">{{ __t("4. 모드 전환과 기존 데이터") }}</h2>
    <ol>
      <li>
        {{
          __t(
            " 공유용·서버 운영에서 필요한 로그인 수단을 준비합니다. 개인용 화면에는 계정 설정이 없으며, 전환 후 초기 설정 또는 운영자 복구 명령을 사용합니다. ",
          )
        }}
      </li>
      <li>
        {{ __t(" 서버를 중지하고 데이터 저장소와 ") }}<code>ai-vault.key</code>,
        <code>ai</code>{{ __t(" 폴더를 함께 백업합니다. ") }}
      </li>
      <li>
        <code>CODEWITH_MODE</code
        >{{ __t(", 접속 주소, 필요한 인증 설정을 변경합니다. ") }}
      </li>
      <li>
        {{
          __t(
            " 같은 데이터 폴더 또는 DB로 재시작합니다. 모드가 바뀌면 기존 세션은 모두 만료되므로 새 모드에서 인증합니다. ",
          )
        }}
      </li>
    </ol>
    <p>
      {{
        __t(
          " 사용자 ID, 워크스페이스 소유권, 멤버 권한, 커밋 작성자, 명세·계획, 개인 AI 연결과 대화는 유지합니다. 복구 키로 로그인한 뒤 새로운 인증 수단을 추가할 수 있습니다. 데이터 경로를 바꾸면 별도 설치로 취급될 수 있으니 명시적으로 이전하세요. ",
        )
      }}
    </p>
    <p>
      {{
        __t(
          " personal은 한 개의 고정된 개인 작업 프로필로 열립니다. 이전 버전에서 사용하던 개인 작업 프로필이 있으면 데이터와 AI 연결을 유지하면서 화면에는 PERSONAL로 표시합니다. 다른 사용자들의 기존 이름과 과거 커밋 작성자 기록은 변경하지 않습니다. 개인 작업 프로필이 없다면 별도 PERSONAL 프로필을 자동 생성하며 다른 사용자의 계정을 임의로 선택하거나 합치지 않습니다. ",
        )
      }}
    </p>
    <p>
      {{
        __t(
          " 이전 AI 로그인 계정도 삭제하지 않습니다. 로그인 키를 발급하면 AI와 무관하게 같은 사용자로 접근합니다. API 키나 AI 계정을 교체해도 CodeWith 로그인 계정을 바꾸거나 다른 사람과 합치지 않습니다. 마지막 AI 연결도 해제할 수 있습니다. ",
        )
      }}
    </p>
    <h2 id="recovery">{{ __t("5. 로그인 키 보관·폐기·복구") }}</h2>
    <p>
      {{
        __t(
          " 개인 키는 256비트 난수이며 DB에는 SHA-256 해시만 저장합니다. 키 파일에는 설치 식별자와 사용자 ID가 포함되지만 인증은 비밀 키로 검증합니다. 키를 가진 사람은 해당 계정에 로그인할 수 있으므로 팀 초대 링크처럼 공유하지 마세요. 브라우저는 키 자체를 localStorage에 저장하지 않고 HttpOnly 세션 쿠키로 로그인을 유지합니다. 세션은 7일 유효합니다. ",
        )
      }}
    </p>
    <p>
      {{
        __t(
          " 공유용·서버 운영에서는 키를 계정 화면에서 추가 발급하거나 폐기할 수 있습니다. 폐기 시 해당 사용자의 이전 세션도 만료되고 현재 브라우저에만 새 세션을 줍니다. 마지막 로그인 수단은 삭제할 수 없습니다. server에서 기본 인증을 바꾸더라도 기존 키를 복구용으로 사용할 수 있습니다. ",
        )
      }}
    </p>
    <p>
      {{
        __t(
          " 모든 로그인 수단을 잃었거나 이전 계정에 로그인할 수 없으면 운영자가 서버를 중지하고 기존 계정의 키를 발급할 수 있습니다. 명령은 기본적으로 변경 예정 내역만 표시하며 ",
        )
      }}<code>--apply</code>{{ __t("를 붙여야 발급합니다. ") }}
    </p>
    <pre>{{
      __t(
        " cd codewith npm run account:key -- --list npm run account:key -- --user admin --output /안전한/경로/codewith-login-key.json npm run account:key -- --user admin --output /안전한/경로/codewith-login-key.json --apply",
      )
    }}</pre>
    <p>
      {{
        __t(
          " 같은 이름의 파일은 덮어쓰지 않습니다. 키 원문은 콘솔에 출력하지 않고 지정한 파일에만 보관합니다. 서버를 다시 시작하고 키 파일로 로그인하세요. 계정 ID와 과거 작성 이력은 변경되지 않습니다. ",
        )
      }}
    </p>
    <h2>{{ __t("6. 검증과 외부 서비스 연결") }}</h2>
    <p>
      {{
        __t(
          " 자동 테스트는 세 모드, 세션 무효화, 계정·데이터 보존, 승인 전 접근 차단, 키 폐기, 이메일 요청의 브라우저 결합·재사용 거부, 위조 패스키 거부, SSO 검증 파라미터를 검사합니다. 브라우저에서는 가상 WebAuthn 인증기로 실제 등록·로그인 왕복을 검사합니다. 이메일 발송과 OIDC는 테스트 전송·공급자 응답을 사용합니다. 실제 메일 전달과 조직 인증 서버 승인은 운영자가 자신의 설정으로 최종 확인해야 합니다. ",
        )
      }}
    </p>
    <p>
      {{ __t(" 구현 근거: ")
      }}<a href="https://simplewebauthn.dev/docs/packages/server">{{
        __t("SimpleWebAuthn 서버")
      }}</a>
      · <a href="https://nodemailer.com/smtp">Nodemailer SMTP</a> ·
      <a href="https://github.com/panva/openid-client">openid-client</a> ·
      <a
        href="https://developer.mozilla.org/en-US/docs/Web/Security/Authentication/Passkeys"
        >{{ __t("MDN 패스키") }}</a
      >
    </p>
    <p>
      <a href="/">{{ __t("CodeWith 열기") }}</a> ·
      <a href="/guide/ai">{{ __t("AI 연결 안내") }}</a>
    </p>
    <section>
      <h2>{{ __t("프로젝트 작업 폴더 연결") }}</h2>
      <p>
        {{
          __t(
            " 개인용은 프로젝트 경로를 바로 연결할 수 있습니다. 공유용·서버 운영에서는 운영자가 허용한 폴더 안에서 워크스페이스 소유자가 경로를 연결합니다. ",
          )
        }}<code>CODEWITH_PROJECT_ROOTS</code
        >{{
          __t(
            "에 허용할 상위 폴더를 지정하세요. 여러 경로는 운영체제 경로 구분자(Linux/WSL은 콜론, Windows는 세미콜론)로 나눕니다. ",
          )
        }}
      </p>
      <pre>
CODEWITH_PROJECT_ROOTS=/srv/projects:/opt/team-code
CODEWITH_MODE=server
npm start</pre>
      <p>
        {{
          __t(
            " 설정하지 않은 공유용 서버에서는 서버 파일 경로 연결을 제공하지 않으며 브라우저 폴더 선택을 사용합니다. 절대 경로는 서버 기준입니다. 시스템 루트·홈 전체·숨김 인증 폴더·CodeWith 데이터 폴더는 연결할 수 없습니다. 프로젝트 분석과 계획 작성은 읽기 전용이며, 일반 채팅의 파일 수정·명령 실행은 연결한 경로와 승인 절차를 사용합니다. ",
          )
        }}
      </p>
      <p>
        {{
          __t(
            " 브라우저 폴더 접근은 지원 브라우저와 HTTPS 또는 localhost 같은 보안 환경을 필요로 합니다. HTTP 사설 IP 등 미지원 환경은 폴더 업로드로 대체됩니다. 경로 연결은 AI 요청마다 자동 재조회하며 폴더 업로드는 사용자가 새 사본을 선택해야 합니다. ",
          )
        }}
      </p>
    </section>
  </article>
</template>
