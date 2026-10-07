# Provider accounts for Paseo

Plugin quản lý nhiều tài khoản cho từng provider của Paseo: Claude, Codex, Copilot, OpenCode, Pi, OMP và agent ACP. Mỗi account là một provider alias (`agents.providers`) và xuất hiện trong bộ chọn model khi tạo agent. (Tên cũ "Agent profiles" đã đổi vì trùng với tính năng Agent profiles — preset model/mode — có sẵn trong Settings của Paseo. ID plugin `paseo-agent-profiles` giữ nguyên.) Ví dụ: `claude-work` và `claude-personal` dùng hai tài khoản Claude khác nhau.

Tương thích **Paseo 0.10.3 và 0.11** (`>=0.10.3 <0.12.0`; SDK dev pin 0.11.0). Plugin dùng `addSurface`/`addSidebarItem`, vẫn chạy trên 0.11 dưới dạng alias deprecated; khi lên 0.12 cần chuyển sang `addScreen`/`addSidebarHeaderItem`. Không cần service hay database riêng.

## Sử dụng

1. Mở **Provider accounts** trong sidebar, hoặc **Manage provider accounts** trong Command Center.
2. **New account** mở hộp thoại → chọn agent → nhập tên (ID như `claude-work` tự điền theo tên).
3. **Sign-in** (Claude/Codex): chỉ hỗ trợ **OAuth qua CLI chính thức**, chạy ngầm trên daemon, không mở terminal. Bấm **Sign in** (Claude) hoặc **Sign in with a device code** / **Use the browser** (Codex), rồi **Open sign-in page**:
   - Trên chính máy chạy daemon: duyệt trong trình duyệt là xong (callback `localhost`).
   - Từ máy khác hoặc điện thoại: Claude chọn **Use a code instead**, mở link, đăng nhập rồi dán mã (cả phần sau `#`); Codex dùng mã thiết bị (cần bật "device code login" trong ChatGPT → Settings → Security).
   - Xong thì hộp thoại hiện email và gói của account; login nằm trong **Account folder**. Bấm lại bất cứ lúc nào để đăng nhập lại. Đóng hộp thoại sẽ hủy lượt đăng nhập đang chờ.
   - Account folder Claude **mới hoặc trống** được nối với `~/.claude` giống chế độ merged của clausona. Settings, CLAUDE.md, skills, hooks, plugins, sessions và history được symlink dùng chung. Login, MCP cấp user (`.claude.json`), backups, policy của org và trạng thái xác thực MCP vẫn riêng từng account. Folder đã có dữ liệu thì không bị đụng tới.
   - Claude cần bản có `claude auth login` (Claude Code 2.x). Các agent khác dùng login của chính CLI đó, hoặc biến môi trường/command trong **More options**.
4. **Add account** / **Save**, rồi chọn account trong bộ chọn model của agent mới. Đóng hộp thoại bằng ✕, Cancel, Esc hoặc bấm ra ngoài (dữ liệu chưa lưu bị bỏ).

Danh sách nhóm theo agent và hiển thị usage của từng account Claude/Codex. Bấm vào một dòng để sửa, dùng công tắc để bật/tắt; nút xóa nằm cuối hộp thoại sửa. Xóa account không xóa thư mục tài khoản và không logout CLI.

## Bảo mật

- Plugin không lưu token hay API key cho Claude/Codex: login do CLI chính thức giữ trong account folder (Claude trên macOS: Keychain của CLI; Codex: `auth.json` hoặc keyring).
- Khi lưu, account Claude/Codex được xóa trắng mọi biến chọn credential/backend khác (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_USE_*`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`…), kể cả giá trị kế thừa từ daemon, và `ANTHROPIC_BASE_URL` được ghim về API chính thức.
- Account tạo bằng bản cũ (token, API key, endpoint riêng) hiện "Old sign-in" trong danh sách; lưu lại sẽ chuyển sang CLI login. Plugin không tự dọn token cũ trong Keychain (service `paseo-agent-profiles`); xóa bằng Keychain Access nếu cần. Account dùng token Keychain sẽ không chạy được nữa cho tới khi chuyển sang CLI login.
- Giá trị env đã lưu không bao giờ được gửi về giao diện.

## Cài đặt và phát triển

```sh
paseo plugin install /absolute/path/to/paseo-agent-profiles
paseo plugin reload paseo-agent-profiles
```

Hoặc dán đường dẫn thư mục vào **Settings → Plugins → Plugin source**. Daemon không cần `npm install`. Khi phát triển (Node 22.18+ hoặc 24+):

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
```

Cấu trúc:

| Đường dẫn | Vai trò |
| --- | --- |
| `shared/` | Hợp đồng RPC và schema (zod) dùng chung client/server |
| `server/profiles.ts` | Đọc/lưu/bật/tắt/xóa alias, ép CLI login cho Claude/Codex |
| `server/login.ts` | Đăng nhập trong app: chạy `claude auth login` / `codex app-server` ngầm, trả link/mã cho hộp thoại |
| `server/usage.ts` | Đọc hạn mức Claude/Codex từ CLI login của từng account |
| `client/draft.ts` | Trạng thái form và chuyển thành input lưu (thuần, có test) |
| `client/profiles.tsx`, `profile-list.tsx`, `profile-form.tsx`, `login-panel.tsx`, `usage.tsx` | Giao diện |
| `client/fluid.tsx` | Design system: bản chuyển sang React Native của [Fluid Functionalism](https://github.com/mickadesign/fluid-functionalism) |

## Ghi chú kỹ thuật (Paseo 0.10.3 / 0.11)

- Patch SDK ở top-level: `{ providers: { id: {...} } }`, xóa bằng `{ removeProviders: [id] }`. Không dùng cả hai cho cùng một ID trong một patch.
- Trong bộ nhớ, `env` được deep-merge, nhưng khi ghi file thì bị thay toàn bộ. Vì vậy server luôn gửi env đầy đủ đã ghép. Không xóa được hẳn một key env: muốn bỏ biến hoặc bỏ custom command thì tạo account mới.
- Chuỗi rỗng dùng để chặn biến kế thừa: cờ `CLAUDE_CODE_USE_*="0"` vẫn bị CLI cũ coi là bật, còn `""` thì không.
- Thứ tự ưu tiên credential của Claude: cloud/gateway, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `apiKeyHelper`, `CLAUDE_CODE_OAUTH_TOKEN`, rồi mới tới login của CLI. Plugin xóa trắng các biến, nhưng `apiKeyHelper` trong settings của Claude vẫn có thể thắng.
- Login CLI của Claude trên macOS nằm trong Keychain với service `Claude Code-credentials-<8 hex đầu của sha256(CLAUDE_CONFIG_DIR)>`. Codex lưu `CODEX_HOME/auth.json` hoặc keyring của OS.
- `claude auth login` gọi `$BROWSER` với link callback `localhost` và in ra stdout link dạng code (`platform.claude.com`), rồi chờ mã trên stdin; CLI chỉ cần mã có hậu tố `#state`. `codex app-server` nói JSON-RPC theo dòng: `initialize` → `initialized` → `account/login/start` (`chatgpt` | `chatgptDeviceCode`) → sự kiện `account/login/completed` → `account/read`.
- Kiểm tra revision chặn việc ghi đè một bản sửa cũ, nhưng API cấu hình chưa có compare-and-swap với các ứng dụng khác.
