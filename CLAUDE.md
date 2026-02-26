# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**WebBrowserForAgent** — AI agent를 위한 완전 제어 가능한 브라우저 툴킷. Playwright 기반으로 Chromium/Firefox/WebKit 브라우저를 제어하며, MCP(Model Context Protocol) 서버로 배포되어 AI agent가 skill 형태로 브라우저를 조작한다.

핵심 기능:
- 설정 가능한 FPS로 주기적 스크린샷 캡처 (agent가 렌더링 상태를 시각적으로 확인)
- **Accessibility Map** — 페이지 내 인터랙션 가능한 요소(버튼, 링크, 폼 등)의 좌표·속성을 텍스트 기반으로 추출. 멀티모달 미지원 모델도 사용 가능.
- 마우스 조작 (이동, 클릭, 더블클릭, 우클릭, 드래그앤드롭)
- 키보드 입력 (텍스트 입력, 특수키, 단축키 조합)
- 멀티 탭 관리 (새 탭 감지, 탭 전환, 탭 목록)
- 페이지 네비게이션 및 브라우저 라이프사이클 관리

## Tech Stack

- **Runtime**: Node.js (>=18)
- **Language**: TypeScript (strict mode)
- **Browser Engine**: Playwright (멀티브라우저 지원)
- **Agent Interface**: MCP Server (`@modelcontextprotocol/sdk`)
- **Package Manager**: pnpm
- **Build**: tsup (ESM output)
- **Test**: Vitest
- **Lint**: ESLint + Prettier

## Commands

```bash
pnpm install          # 의존성 설치 (playwright 브라우저 포함)
pnpm build            # TypeScript → dist/ 빌드
pnpm dev              # 개발 모드 (watch)
pnpm test             # 전체 테스트 실행
pnpm test -- <file>   # 단일 테스트 파일 실행
pnpm lint             # ESLint 검사
pnpm format           # Prettier 포맷팅
pnpm mcp:stdio        # MCP 서버 실행 (stdio transport, 로컬 연동)
pnpm mcp:http         # MCP 서버 실행 (Streamable HTTP transport, 원격 배포)
```

## Architecture

```
src/
├── core/                    # 브라우저 제어 핵심 로직
│   ├── browser.ts           # BrowserManager - 브라우저/탭 생성·종료·전환, 뷰포트 관리
│   ├── screenshot.ts        # ScreenshotEngine - FPS 기반 주기적 캡처, 단일 캡처
│   ├── accessibility.ts     # AccessibilityMapper - 페이지 인터랙션 요소 좌표 맵 추출
│   └── input.ts             # InputController - 마우스/키보드/드래그 통합 입력
├── mcp/                     # MCP 서버 레이어
│   ├── server.ts            # MCP 서버 진입점, tool 등록, transport 선택
│   └── tools/               # 개별 MCP tool 정의 (skill 단위)
│       ├── navigation.ts    # browser_launch, browser_navigate, browser_back, browser_forward, browser_close, browser_resize (디바이스 프리셋 포함)
│       ├── tab.ts           # browser_list_tabs, browser_switch_tab, browser_close_tab, browser_new_tab
│       ├── screenshot.ts    # browser_screenshot, browser_start_recording, browser_stop_recording
│       ├── accessibility.ts # browser_get_accessibility_map
│       ├── mouse.ts         # browser_click, browser_double_click, browser_right_click, browser_drag, browser_mouse_move, browser_scroll
│       └── keyboard.ts      # browser_type, browser_key_press, browser_hotkey
└── index.ts                 # 라이브러리 export (core 모듈 직접 사용 시)
```

### 핵심 클래스 관계

1. **BrowserManager** — Playwright Browser 인스턴스와 다수의 Page(탭)를 관리. 활성 탭(activePage) 추적, 뷰포트 크기 제어. `page` 이벤트를 감지하여 새 탭 자동 등록.
2. **ScreenshotEngine** — BrowserManager의 activePage를 받아 스크린샷 수행. FPS 녹화 모드에서는 스크린샷만 캡처 (accessibility map 미포함, 성능 보장). 단일 `browser_screenshot()` 호출 시에만 accessibility map을 함께 생성.
3. **AccessibilityMapper** — activePage(+ 모든 child frame)에서 인터랙션 가능한 요소를 탐색하여 bounding box 좌표, 텍스트, role, 속성을 구조화된 텍스트로 추출. `page.evaluate()`로 DOM을 직접 쿼리하고, `element.boundingBox()`로 좌표 계산. (`page.accessibility.snapshot()`은 deprecated이므로 사용하지 않음.)
4. **InputController** — BrowserManager의 activePage를 받아 모든 입력 이벤트 수행. 좌표 기반 또는 elementIndex 기반 조작.
5. **MCP Tools** — 위 4개 core 클래스를 조합하여 agent-facing skill로 노출. 각 tool은 JSON Schema input/output 정의.

### 데이터 흐름

```
AI Agent → MCP Tool 호출 → Core 클래스 메서드 → Playwright API → 브라우저
                                                                    ↓
AI Agent ← base64 PNG + accessibility map ← ScreenshotEngine ←─────┘
```

## Accessibility Map

온디맨드로 생성되는 텍스트 기반 페이지 구조 데이터. `browser_screenshot()` 또는 `browser_get_accessibility_map()`으로 조회.

### 추출 방식

`page.accessibility.snapshot()`은 Playwright에서 deprecated. 대신:
1. `page.evaluate()`로 DOM에서 인터랙션 가능한 요소를 직접 쿼리 (`a, button, input, select, textarea, [role="button"], [role="link"], [tabindex], [contenteditable]` 등)
2. 각 요소에 대해 `elementHandle.boundingBox()`로 뷰포트 내 좌표 계산
3. `page.frames()`로 모든 iframe을 재귀 탐색하여 iframe 내부 요소도 포함
4. 뷰포트 밖 요소(bounding box가 뷰포트 범위 바깥)는 제외하고, 현재 보이는 요소만 반환

### 출력 형식

```
[Accessibility Map - 6 elements, frame: main]
[0] button "로그인" @ (350, 420, 120, 40) - clickable
[1] link "회원가입" @ (500, 425, 80, 20) - href="/signup"
[2] input[text] "이메일" @ (300, 300, 200, 35) - placeholder="email@example.com"
[3] input[password] "비밀번호" @ (300, 350, 200, 35)
[4] select "언어 선택" @ (600, 50, 100, 30) - options: ["한국어", "English", "日本語"]
[5] checkbox "자동 로그인" @ (300, 390, 20, 20) - unchecked

[Accessibility Map - 1 element, frame: iframe#payment-form]
[6] input[text] "카드번호" @ (100, 200, 250, 35) - placeholder="0000-0000-0000-0000"
```

- 각 요소는 전체 페이지(iframe 포함) 기준으로 유니크한 인덱스 부여
- 좌표는 `(x, y, width, height)` 형식, 클릭 시 요소 중심점 `(x + width/2, y + height/2)` 자동 계산
- iframe 내 요소는 소속 frame 정보와 함께 표시, 좌표는 메인 프레임 기준으로 변환
- `browser_screenshot({ includeAccessibilityMap: true })` (기본값 true) 또는 `browser_get_accessibility_map()` 단독 호출로 제어

## 스크린샷 & 녹화

### 뷰포트 & 해상도

| 설정 | 기본값 | 범위 | 비고 |
|------|--------|------|------|
| 뷰포트 너비 | 1280px | 320–1280 | `browser_launch`, `browser_resize`, 또는 디바이스 프리셋으로 설정 |
| 뷰포트 높이 | 720px | 480–720 | 동일 |
| 스크린샷 스케일 | 1x | 1x–2x | deviceScaleFactor. 2x는 Retina/모바일 고밀도 디스플레이 시뮬레이션 |

최대 해상도 1280×720으로 제한하여 스크린샷 파일 크기를 적정 수준(100KB–500KB)으로 유지. AI agent의 토큰 소비와 처리 속도에 최적화된 상한.

### 디바이스 프리셋

`browser_resize`에서 `{ device }` 파라미터로 모바일/태블릿 뷰포트를 간편 설정. Playwright의 `devices` 레지스트리 기반.

| 프리셋 | 뷰포트 | userAgent | 비고 |
|--------|--------|-----------|------|
| `desktop` | 1280×720 | Desktop Chrome | 기본값 |
| `iphone-14` | 390×844 | Mobile Safari | iOS 모바일 |
| `iphone-14-landscape` | 844×390 | Mobile Safari | 가로 모드 |
| `pixel-7` | 412×915 | Mobile Chrome | Android 모바일 |
| `ipad-pro-11` | 834×720 | Mobile Safari | 태블릿 (높이 720 캡) |

- 디바이스 프리셋 적용 시 `userAgent`, `hasTouch`, `isMobile` 등 Playwright 디바이스 속성도 함께 설정
- agent가 반응형 웹 디자인 테스트, 모바일 전용 UI 확인 등에 활용
- 프리셋 높이가 720을 초과하는 경우 720으로 클램핑 (스크린샷 크기 상한 유지)
- 커스텀 뷰포트도 가능: `browser_resize({ width: 375, height: 667 })` — 범위 내 자유 설정

### 단일 캡처 (`browser_screenshot`)

- 즉시 스크린샷 + accessibility map 반환
- 녹화 중이면 링 버퍼의 최신 프레임 반환 (accessibility map은 이 시점에 새로 생성)
- 응답: `{ image: base64 PNG, accessibilityMap: string }`

### FPS 녹화 모드

- `browser_start_recording({ fps })` → 주기적 캡처 시작
- **녹화 중에는 스크린샷만 캡처, accessibility map은 생성하지 않음** (성능 보장)
- `browser_screenshot()` 호출 시 최신 프레임 + 그 시점의 accessibility map을 함께 반환
- `browser_stop_recording()` → 캡처 중단, 버퍼 정리

| 설정 | 기본값 | 범위 | 비고 |
|------|--------|------|------|
| FPS | - | 1–5 | 5 초과는 거부. AI agent 의사결정 속도 대비 불필요 |
| 링 버퍼 크기 | 10 프레임 | 5–30 | 1280×720 PNG 기준 최대 ~15MB (500KB × 30) |

링 버퍼는 `Buffer` (raw bytes)로 저장하고, agent 요청 시에만 base64 인코딩하여 반환. base64 문자열 대비 ~33% 메모리 절약.

## 멀티 탭 관리

### 정책

- `browser_launch` 시 단일 탭으로 시작
- `window.open()`, `target="_blank"` 등으로 새 탭이 열리면 BrowserManager가 자동 감지하여 탭 목록에 등록
- **새 탭이 열려도 활성 탭은 자동 전환하지 않음** — agent가 명시적으로 `browser_switch_tab`을 호출해야 전환
- 단, `browser_list_tabs` 응답에 새 탭이 열렸음을 표시하여 agent가 인지 가능

### MCP Tools

- `browser_list_tabs()` → `[{ tabIndex: 0, url, title, isActive }, ...]`
- `browser_switch_tab({ tabIndex })` → 해당 탭을 활성 탭으로 전환
- `browser_new_tab({ url? })` → 새 탭 열기, 선택적 URL 이동
- `browser_close_tab({ tabIndex? })` → 특정 탭 닫기 (미지정 시 활성 탭)

## MCP Transport

| Transport | 용도 | 명령 |
|-----------|------|------|
| **stdio** | 로컬 연동 (Claude Desktop, CLI 등에서 직접 프로세스 실행) | `pnpm mcp:stdio` |
| **Streamable HTTP** | 원격 배포 (Docker, 클라우드 서버에서 headless 브라우저 구동, agent가 네트워크로 연결) | `pnpm mcp:http` |

HTTP transport 기본 포트: `3100`. 환경변수 `MCP_HTTP_PORT`로 변경 가능.

## Design Principles

- **듀얼 모드 조작**: 모든 마우스 이벤트는 `{ x, y }` 픽셀 좌표 또는 `{ elementIndex }` 인덱스로 사용 가능. 멀티모달 agent는 스크린샷으로 좌표 결정, 텍스트 전용 agent는 accessibility map의 인덱스로 조작.
- **accessibility map은 온디맨드**: FPS 녹화 중에는 스크린샷만 캡처. accessibility map은 agent가 명시적으로 요청할 때만 생성 (DOM 쿼리 + boundingBox 계산 비용이 높으므로).
- **iframe 재귀 탐색**: accessibility map은 메인 프레임뿐 아니라 모든 child iframe을 재귀적으로 탐색. 좌표는 메인 프레임 기준으로 변환하여 agent가 프레임을 의식하지 않고 조작 가능.
- **명시적 탭 전환**: 새 탭이 열려도 agent가 `browser_switch_tab`을 호출하기 전까지 활성 탭 변경 없음. 예측 불가능한 컨텍스트 전환 방지.
- **Stateful 세션**: 브라우저는 한 번 launch하면 close할 때까지 상태 유지. 쿠키, 로그인 세션 등 보존.
- **base64 PNG**: 스크린샷은 항상 base64 인코딩된 PNG로 반환. MCP image content type 활용.
- **에러는 tool result로**: 브라우저 에러(네비게이션 실패, 타임아웃 등)는 MCP tool의 에러 응답으로 전달. 서버 크래시 방지.
