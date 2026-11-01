import type { Locale } from '../i18n'

export interface PromptSample {
  id: string
  name: Record<Locale, string>
  text: Record<Locale, string>
}

// Kept in code, not in vue-i18n: message syntax would eat the `{file}` style variables.
export const PROMPT_SAMPLES: readonly PromptSample[] = [
  {
    id: 'review-diff',
    name: { en: 'Review my changes', vi: 'Review thay đổi của tôi' },
    text: {
      en: 'Review my uncommitted changes on {branch}:\n{diffstat}\n\nLook for bugs, missing edge cases, unclear names and dead code. List findings by severity with file:line. Do not change code yet.',
      vi: 'Review các thay đổi chưa commit trên {branch}:\n{diffstat}\n\nTìm bug, trường hợp biên còn thiếu, tên khó hiểu và code thừa. Liệt kê theo mức độ nghiêm trọng kèm file:dòng. Chưa sửa code.',
    },
  },
  {
    id: 'write-tests',
    name: { en: 'Write tests for this file', vi: 'Viết test cho file này' },
    text: {
      en: 'Write tests for {file}. Cover the main paths, edge cases and error handling. Follow the test style already used in this project, then run them.',
      vi: 'Viết test cho {file}. Phủ luồng chính, trường hợp biên và xử lý lỗi. Theo đúng kiểu test project đang dùng, viết xong thì chạy.',
    },
  },
  {
    id: 'explain-file',
    name: { en: 'Explain this file', vi: 'Giải thích file này' },
    text: {
      en: 'Explain {file}: what it does, how it fits into the project, who calls it and anything surprising. Keep it short.',
      vi: 'Giải thích {file}: làm gì, nằm ở đâu trong project, ai gọi nó và có gì bất ngờ. Ngắn gọn.',
    },
  },
  {
    id: 'fix-checks',
    name: { en: 'Fix the Checks errors', vi: 'Sửa lỗi Checks' },
    text: {
      en: 'Fix these errors from the last check run:\n{checks}\n\nFix the cause, not the symptom, then run the check again.',
      vi: 'Sửa các lỗi từ lần chạy Checks gần nhất:\n{checks}\n\nSửa tận gốc, không che triệu chứng, rồi chạy lại Checks.',
    },
  },
  {
    id: 'commit-message',
    name: { en: 'Commit message from changes', vi: 'Commit message từ thay đổi' },
    text: {
      en: 'Write a commit message for these changes on {branch}:\n{diffstat}\n\nOne short subject line, then a body that says why. Only write the message; do not run git commit.',
      vi: 'Viết commit message cho các thay đổi trên {branch}:\n{diffstat}\n\nMột dòng tiêu đề ngắn, phần thân nói lý do. Chỉ viết message, không chạy git commit.',
    },
  },
  {
    id: 'refactor-selection',
    name: { en: 'Refactor the selection', vi: 'Refactor đoạn đang chọn' },
    text: {
      en: 'Refactor this code from {file} without changing its behaviour:\n\n{selection}\n\nExplain each change in one line.',
      vi: 'Refactor đoạn code này trong {file}, không đổi hành vi:\n\n{selection}\n\nGiải thích mỗi thay đổi trong một dòng.',
    },
  },
  {
    id: 'find-bugs',
    name: { en: 'Find bugs', vi: 'Tìm bug' },
    text: {
      en: 'Look for bugs in {file}: wrong conditions, unhandled errors, race conditions, leaks. Report each with its line and a suggested fix. Do not change code yet.',
      vi: 'Tìm bug trong {file}: điều kiện sai, lỗi không được xử lý, race condition, rò rỉ tài nguyên. Báo từng lỗi kèm dòng và cách sửa đề xuất. Chưa sửa code.',
    },
  },
  {
    id: 'write-docs',
    name: { en: 'Write docs or README', vi: 'Viết docs / README' },
    text: {
      en: 'Write or update the documentation for {file}: a README section or doc comments, whichever this project uses. Keep it accurate to the code.',
      vi: 'Viết hoặc cập nhật tài liệu cho {file}: một mục README hoặc doc comment, theo cách project đang dùng. Phải đúng với code.',
    },
  },
  {
    id: 'performance',
    name: { en: 'Speed it up', vi: 'Tối ưu hiệu năng' },
    text: {
      en: 'Find performance problems in {file}: needless work in loops, repeated I/O, large allocations, blocking calls. Explain the expected gain before changing anything.',
      vi: 'Tìm chỗ chậm trong {file}: việc thừa trong vòng lặp, I/O lặp lại, cấp phát lớn, lời gọi chặn. Nói rõ lợi ích dự kiến trước khi sửa.',
    },
  },
  {
    id: 'security',
    name: { en: 'Security check', vi: 'Kiểm tra bảo mật' },
    text: {
      en: 'Check {file} for security issues: injection, path traversal, unsafe input handling, secrets in code, missing permission checks. List each with severity and a fix.',
      vi: 'Kiểm tra bảo mật {file}: injection, path traversal, xử lý input không an toàn, secret trong code, thiếu kiểm quyền. Liệt kê kèm mức độ và cách sửa.',
    },
  },
  {
    id: 'translate-strings',
    name: { en: 'Translate UI strings', vi: 'Dịch chuỗi giao diện' },
    text: {
      en: "Find user-facing strings in {file} that are hard-coded and move them into the project's i18n files, with a translation for every language the project supports.",
      vi: 'Tìm chuỗi hiển thị cho người dùng đang viết cứng trong {file}, chuyển vào file i18n của project và dịch đủ mọi ngôn ngữ project hỗ trợ.',
    },
  },
  {
    id: 'branch-summary',
    name: { en: 'Summarise this branch', vi: 'Tóm tắt nhánh này' },
    text: {
      en: 'Summarise what changed on {branch} in {wt}:\n{diffstat}\n\nGroup by feature, point out risks and anything unfinished.',
      vi: 'Tóm tắt những gì đã đổi trên {branch} trong {wt}:\n{diffstat}\n\nGom theo tính năng, chỉ ra rủi ro và phần còn dở.',
    },
  },
]

export const sampleById = (id: string): PromptSample | undefined => PROMPT_SAMPLES.find((s) => s.id === id)
