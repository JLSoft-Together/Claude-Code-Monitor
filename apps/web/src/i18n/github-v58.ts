// Merged at the root of en.ts / vi.ts in v58: GitHub accounts (Settings + Push dialog).
const en = {
  github: {
    section: 'GitHub accounts',
    empty: 'No accounts yet. Git uses its own credentials (Git Credential Manager).',
    default: 'Default',
    makeDefault: 'Make default',
    removeFor: 'Remove {login}',
    fineGrained: 'Fine-grained token',
    noRepoScope: 'Token has no repo scope: pushing to private repos will fail.',
    token: 'Personal access token',
    tokenPlaceholder: 'ghp_… or github_pat_…',
    add: 'Add account',
    checking: 'Checking…',
    added: 'Added {login}.',
    generate: 'Generate a token on GitHub…',
    hint: 'Classic token with the repo scope, or a fine-grained token with Contents read and write. Orrery checks it with GitHub, keeps it encrypted by the OS keychain and never shows it again. Push, fetch and pull pick the account that can reach the repo, default first.',
    manage: 'Manage accounts…',
    error: {
      invalid: 'GitHub refused this token. Copy it again or generate a new one.',
      network: 'Could not reach GitHub. Check the connection and try again.',
      'no-keychain': 'The OS keychain is not available, so the token cannot be stored safely.',
      'not-found': 'That account is no longer there.',
      cancelled: 'Cancelled.',
      denied: 'Not available here.',
      failed: 'Could not add the account.',
    },
    pick: {
      label: 'Account',
      auto: 'Automatic (Git Credential Manager)',
      autoAs: 'Automatic ({login})',
      system: 'Git Credential Manager',
    },
    note: {
      nobody: 'None of your accounts can reach {repo}. Git Credential Manager is used.',
      none: '{login} has no access to {repo}.',
      read: '{login} can read {repo} but not push to it.',
    },
    authHint: {
      add: 'Add the GitHub account that owns this repo with a token.',
      other: 'Pick another account above, or add the one that can reach this repo.',
    },
  },
}

const vi: typeof en = {
  github: {
    section: 'Tài khoản GitHub',
    empty: 'Chưa có tài khoản nào. Git dùng thông tin đăng nhập riêng của nó (Git Credential Manager).',
    default: 'Mặc định',
    makeDefault: 'Đặt mặc định',
    removeFor: 'Gỡ {login}',
    fineGrained: 'Token fine-grained',
    noRepoScope: 'Token thiếu quyền repo: push lên repo private sẽ lỗi.',
    token: 'Personal access token',
    tokenPlaceholder: 'ghp_… hoặc github_pat_…',
    add: 'Thêm tài khoản',
    checking: 'Đang kiểm tra…',
    added: 'Đã thêm {login}.',
    generate: 'Tạo token trên GitHub…',
    hint: 'Token classic có quyền repo, hoặc token fine-grained có quyền Contents đọc và ghi. Orrery kiểm tra token với GitHub, mã hoá bằng keychain của hệ điều hành và không hiện lại nữa. Push, fetch, pull sẽ chọn tài khoản vào được repo, ưu tiên tài khoản mặc định.',
    manage: 'Quản lý tài khoản…',
    error: {
      invalid: 'GitHub từ chối token này. Hãy copy lại hoặc tạo token mới.',
      network: 'Không kết nối được GitHub. Kiểm tra mạng rồi thử lại.',
      'no-keychain': 'Keychain của hệ điều hành không dùng được nên không lưu token an toàn được.',
      'not-found': 'Tài khoản đó không còn nữa.',
      cancelled: 'Đã huỷ.',
      denied: 'Không dùng được ở đây.',
      failed: 'Không thêm được tài khoản.',
    },
    pick: {
      label: 'Tài khoản',
      auto: 'Tự động (Git Credential Manager)',
      autoAs: 'Tự động ({login})',
      system: 'Git Credential Manager',
    },
    note: {
      nobody: 'Không tài khoản nào của bạn vào được {repo}. Đang dùng Git Credential Manager.',
      none: '{login} không có quyền vào {repo}.',
      read: '{login} đọc được {repo} nhưng không push được.',
    },
    authHint: {
      add: 'Thêm tài khoản GitHub có quyền vào repo này bằng token.',
      other: 'Chọn tài khoản khác ở trên, hoặc thêm tài khoản vào được repo này.',
    },
  },
}

export default { en, vi }
