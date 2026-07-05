# WebBrowserForAgent

AI agent가 실제 브라우저를 직접 제어할 수 있는 MCP(Model Context Protocol) 서버.

Playwright 기반으로 Chromium, Firefox, WebKit을 지원하며, 스크린샷 캡처, 마우스/키보드 입력, 멀티 탭 관리, 그리고 **Accessibility Map**(텍스트 기반 페이지 구조 맵)을 통해 멀티모달 여부와 관계없이 모든 AI 모델이 웹 브라우저를 조작할 수 있다.

## Features

- **Screenshot Capture** — 단일 캡처 및 FPS 기반 연속 녹화 (1–5 FPS, 링 버퍼)
- **Accessibility Map** — 페이지 내 모든 인터랙션 가능한 요소의 좌표·role·속성을 텍스트로 추출. 비전 없이도 브라우저 조작 가능
- **Dual-mode Targeting** — `{x, y}` 좌표 또는 `{elementIndex}` 인덱스로 클릭/입력 가능
- **Full Input Control** — 클릭, 더블클릭, 우클릭, 드래그, 스크롤, 텍스트 입력, 단축키
- **Multi-tab Management** — 새 탭 자동 감지, 명시적 탭 전환, 탭 열기/닫기
- **Device Presets** — 데스크톱, iPhone, Pixel, iPad 등 모바일/태블릿 뷰포트
- **Dual Transport** — stdio (로컬) / Streamable HTTP (원격)

## 요구사항

- **Node.js** >= 18
- **OS**: macOS, Windows, Linux (headless 서버 포함)

### Headless Linux 서버 (Ubuntu, Debian 등)

Playwright는 GUI 없는 CLI 전용 환경에서도 headless 모드로 정상 작동한다. Docker, CI/CD, 클라우드 서버 모두 가능. 단, 브라우저 실행에 필요한 시스템 라이브러리를 설치해야 한다:

```bash
# Playwright가 필요로 하는 OS 레벨 의존성 자동 설치 (root 권한 필요)
npx playwright install-deps chromium
```

주요 필요 라이브러리: `libnss3`, `libatk-bridge2.0-0`, `libdrm2`, `libxkbcommon0`, `libgbm1` 등. 위 명령이 apt를 통해 자동으로 설치한다.

### Docker

```dockerfile
FROM node:20-slim

# pnpm 활성화 (Node에 Corepack으로 번들됨)
RUN corepack enable

# Playwright 시스템 의존성 설치
RUN npx playwright install-deps chromium

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
RUN npx playwright install chromium

COPY . .
RUN pnpm build

EXPOSE 3100
CMD ["node", "dist/mcp/server.js", "--transport", "http"]
```

### 리소스 요구사항

| 항목 | 최소 | 권장 |
|------|------|------|
| RAM | 512MB | 1GB+ |
| CPU | 1 core | 2+ cores |
| Disk | 500MB (Chromium 바이너리) | 1GB+ |

Chromium 인스턴스 하나당 약 200–500MB 메모리를 사용한다. 복잡한 페이지일수록 더 많은 메모리가 필요하다.

## 제약사항

- **싱글 브라우저 세션**: 하나의 MCP 서버 인스턴스당 하나의 브라우저만 실행 가능. 동시에 여러 브라우저를 띄우려면 MCP 서버를 여러 개 실행해야 한다.
- **뷰포트 크기 제한**: 최대 1280×720. AI agent의 토큰 소비 최적화를 위한 의도적 제한. 이 이상의 해상도가 필요하면 스크롤로 페이지를 탐색해야 한다.
- **파일 다운로드/업로드**: 현재 파일 다운로드 및 `<input type="file">` 업로드는 지원하지 않는다.
- **인증 팝업**: HTTP Basic Auth, OS 레벨 인증 다이얼로그는 처리하지 않는다. 웹 기반 로그인 폼만 지원.
- **WebRTC/미디어**: 카메라, 마이크, 화상통화 등 미디어 스트림 관련 기능은 지원하지 않는다.
- **HTTP transport 보안**: HTTP 모드는 기본적으로 `127.0.0.1`에만 바인딩되며, Host 헤더 허용목록(DNS 리바인딩 방어)을 적용하여 loopback 바인딩에서도 악성 웹페이지가 엔드포인트에 접근하지 못하게 한다. `/mcp` 엔드포인트에는 **내장 인증이 없다** — 비-loopback 호스트에 바인딩하면 사용자의 로그인 세션을 가진 브라우저의 전체 제어권이 노출되므로, 인증을 수행하는 리버스 프록시 + TLS 구성이 **선택이 아니라 필수**다. 원격 바인딩 시 `MCP_HTTP_ALLOWED_HOSTS`(선택적으로 `MCP_HTTP_ALLOWED_ORIGINS`)에 클라이언트가 접속하는 호스트명을 설정할 것.
- **동시 접속**: HTTP transport에서 여러 MCP 클라이언트가 동시에 연결되면 하나의 브라우저 인스턴스를 공유하게 되므로, 상태 충돌이 발생할 수 있다. 클라이언트당 별도 서버 인스턴스를 사용할 것.
- **Playwright 브라우저 설치 필요**: npm 패키지에는 브라우저 바이너리가 포함되지 않는다. 설치 후 `npx playwright install chromium`을 별도 실행해야 한다. Firefox/WebKit 사용 시에도 각각 설치 필요.

## Quick Start

### npm으로 설치

```bash
npm install web-browser-for-agent
```

설치 후 Playwright Chromium 브라우저를 별도로 설치해야 합니다:

```bash
npx playwright install chromium
```

### Claude Desktop / MCP 클라이언트에서 사용

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "web-browser": {
      "command": "npx",
      "args": ["web-browser-for-agent", "--transport", "stdio"]
    }
  }
}
```

### HTTP 서버로 실행

```bash
npx web-browser-for-agent --transport http
# MCP HTTP server listening on 127.0.0.1:3100
```

환경변수로 설정:

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `MCP_HTTP_PORT` | `3100` | 리슨 포트 |
| `MCP_HTTP_HOST` | `127.0.0.1` | 바인드 주소. 비-loopback 바인딩은 리버스 프록시 필요 ([제약사항](#제약사항) 참고) |
| `MCP_HTTP_ALLOWED_HOSTS` | loopback + 바인드 | Host 헤더 허용목록(DNS 리바인딩 방어), 쉼표 구분 |
| `MCP_HTTP_ALLOWED_ORIGINS` | _(제한 없음)_ | Origin 허용목록, 쉼표 구분 |

## MCP Tools

### Navigation

| Tool | Description |
|------|-------------|
| `browser_launch` | 브라우저 실행 (브라우저 엔진, 뷰포트, 디바이스 프리셋 설정) |
| `browser_navigate` | URL로 이동 |
| `browser_back` | 뒤로 가기 |
| `browser_forward` | 앞으로 가기 |
| `browser_close` | 브라우저 종료 |
| `browser_resize` | 뷰포트 크기 변경, 또는 디바이스 프리셋의 크기만 적용 (UA/터치 에뮬레이션 없음) |

### Screenshot & Recording

| Tool | Description |
|------|-------------|
| `browser_screenshot` | 스크린샷 캡처 + Accessibility Map |
| `browser_start_recording` | FPS 기반 연속 캡처 시작 (1–5 FPS) |
| `browser_stop_recording` | 연속 캡처 중단 |

### Accessibility

| Tool | Description |
|------|-------------|
| `browser_get_accessibility_map` | 현재 페이지의 인터랙션 요소 맵 조회 |

### Mouse

| Tool | Description |
|------|-------------|
| `browser_click` | 클릭 (좌표 또는 elementIndex) |
| `browser_double_click` | 더블클릭 |
| `browser_right_click` | 우클릭 |
| `browser_drag` | 드래그 앤 드롭 |
| `browser_mouse_move` | 마우스 이동 (hover) |
| `browser_scroll` | 스크롤 |

### Keyboard

| Tool | Description |
|------|-------------|
| `browser_type` | 텍스트 입력 |
| `browser_key_press` | 단일 키 입력 (Enter, Tab, Escape 등) |
| `browser_hotkey` | 키 조합 (Ctrl+A, Cmd+C 등) |

### Tab Management

| Tool | Description |
|------|-------------|
| `browser_list_tabs` | 열린 탭 목록 조회 |
| `browser_switch_tab` | 탭 전환 |
| `browser_new_tab` | 새 탭 열기 |
| `browser_close_tab` | 탭 닫기 |

## Accessibility Map

멀티모달을 지원하지 않는 모델도 브라우저를 조작할 수 있도록, 페이지 내 인터랙션 가능한 모든 요소를 텍스트로 추출한다.

### 출력 예시

```
[Accessibility Map - 5 elements, frame: main]
[0] button "Login" @ (350, 420, 120, 40)
[1] link "Sign Up" @ (500, 425, 80, 20) - href=https://example.com/signup
[2] input[text] "" @ (300, 300, 200, 35) - placeholder=Email address
[3] input[password] "" @ (300, 350, 200, 35) - placeholder=Password
[4] checkbox "Remember me" @ (300, 390, 20, 20) - unchecked

[Accessibility Map - 1 element, frame: iframe#payment]
[5] input[text] "" @ (100, 200, 250, 35) - placeholder=Card number
```

- 각 요소에 고유 인덱스 부여 → `browser_click({ target: { elementIndex: 0 } })`으로 조작
- iframe 내부 요소도 자동 탐색, 메인 프레임 기준 좌표로 변환
- `cursor:pointer`, `onclick` 등 비표준 클릭 가능 요소도 감지
- 링크 href는 DOM에서 절대 URL로 변환됨 (예: `example.com`의 `/signup` 링크는 `href=https://example.com/signup`)

### 추출 대상

표준 인터랙티브 요소: `a[href]`, `button`, `input`, `select`, `textarea`, `[role="button"]`, `[role="link"]`, `[role="checkbox"]`, `[role="radio"]`, `[role="tab"]`, `[role="menuitem"]`, `[tabindex]`, `[contenteditable]`

비표준 클릭 가능 요소: `cursor: pointer` 스타일, `onclick`/`@click`/`ng-click` 속성

## Device Presets

| Preset | 디바이스 뷰포트 | 적용값 (클램핑) | Description |
|--------|-----------------|------------------|-------------|
| `desktop` | 1280×720 | 1280×720 | 기본값 |
| `iphone-14` | 390×664 | 390×664 | iOS 모바일 |
| `iphone-14-landscape` | 750×340 | 750×480 | 가로 모드 |
| `pixel-7` | 412×839 | 412×720 | Android 모바일 |
| `ipad-pro-11` | 834×1194 | 834×720 | 태블릿 |

뷰포트는 320–1280(너비) × 480–720(높이) 범위로, 디바이스 스케일 팩터는 2×로 클램핑된다 (스크린샷 크기를 토큰 최적화 상한 내로 유지). `browser_launch({ device })`는 전체 모바일 에뮬레이션(userAgent, 터치, `isMobile`)을 적용하고, `browser_resize({ device })`는 **뷰포트 크기만** 적용한다.

> 프리셋 뷰포트 값은 설치된 Playwright 디바이스 레지스트리를 따른다 (Playwright 1.58.x 기준 확인).

## Programmatic Usage

MCP 서버 외에도 코어 모듈을 직접 import하여 사용할 수 있다:

```typescript
import {
  BrowserManager,
  AccessibilityMapper,
  ScreenshotEngine,
  InputController,
} from 'web-browser-for-agent';

const browser = new BrowserManager();
const mapper = new AccessibilityMapper();
const screenshot = new ScreenshotEngine(mapper);
const input = new InputController();

await browser.launch({ headless: true });
const page = browser.getActivePage();
await page.goto('https://example.com');

// Screenshot + Accessibility Map
const viewport = browser.getViewport();
const result = await screenshot.capture(page, viewport, true);
console.log(AccessibilityMapper.formatAsText(result.accessibilityMap!));

// Click by element index — 생성된 맵에서 find 헬퍼 사용 가능
const map = await mapper.generateMap(page, viewport);
const loginBtn = map.findByText('Login');
if (loginBtn) {
  await input.click(page, { elementIndex: loginBtn.index }, map);
}

await browser.close();
```

## Development

```bash
git clone https://github.com/MosslandOpenDevs/WebBrowserForAgent.git
cd WebBrowserForAgent
pnpm install
pnpm build
pnpm test
```

| Command | Description |
|---------|-------------|
| `pnpm build` | TypeScript → dist/ 빌드 |
| `pnpm dev` | watch 모드 빌드 |
| `pnpm test` | 전체 테스트 실행 |
| `pnpm test -- src/core/__tests__/browser.test.ts` | 단일 테스트 |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |

## Architecture

```
src/
├── core/                    # Browser control core
│   ├── browser.ts           # BrowserManager — browser/tab lifecycle, viewport
│   ├── screenshot.ts        # ScreenshotEngine — capture, FPS recording, ring buffer
│   ├── accessibility.ts     # AccessibilityMapper — DOM query, bounding box extraction
│   ├── input.ts             # InputController — mouse, keyboard, drag
│   └── errors.ts            # Custom error classes
├── mcp/
│   ├── server.ts            # MCP server entry point, transport selection
│   └── tools/               # MCP tool definitions (one file per domain)
└── index.ts                 # Library re-exports
```

## License

[MIT](./LICENSE)
