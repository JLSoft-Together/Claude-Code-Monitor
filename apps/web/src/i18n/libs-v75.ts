// Top-level `libVulns` of en.ts / vi.ts (v75): OSV advisories in the library updates table.
const en = {
  libVulns: {
    check: 'Security',
    checkHint: 'Ask osv.dev about known vulnerabilities (sends only each library name and version in use)',
    recheck: 'Check vulnerabilities again (skip the 1 hour cache)',
    column: 'Security',
    vulnerableOnly: 'Vulnerable only',
    summary: 'No known vulnerabilities | {n} vulnerable library | {n} vulnerable libraries',
    count: '{n} advisory | {n} advisories',
    clean: 'None known',
    fixedIn: 'fixed in {v}',
    noFix: 'no fix yet',
    show: 'Show advisories of {name}',
    openAdvisory: 'Open advisory {id} on osv.dev',
    noSummary: 'No summary (record not loaded)',
    severity: { critical: 'Critical', high: 'High', moderate: 'Moderate', low: 'Low', unknown: 'Unrated' },
    loading: 'Asking osv.dev…',
    error: {
      invalid: 'A library name or version cannot be sent to osv.dev.',
      'too-many': 'Too many libraries for one vulnerability check (300 at most).',
      unavailable: 'The vulnerability check needs the desktop app.',
      network: 'osv.dev could not be reached. The update check above still works; try Security again when online.',
      timeout: 'osv.dev did not answer in time. Try Security again.',
      'bad-response': 'osv.dev sent a reply that could not be read. Try Security again later.',
    },
    note: 'Security asks osv.dev only when you press it, with library names and versions only; answers are kept for 1 hour.',
  },
}

const vi: typeof en = {
  libVulns: {
    check: 'Bảo mật',
    checkHint: 'Hỏi osv.dev các lỗ hổng đã biết (chỉ gửi tên và phiên bản đang dùng của từng thư viện)',
    recheck: 'Kiểm lại lỗ hổng (bỏ qua cache 1 giờ)',
    column: 'Bảo mật',
    vulnerableOnly: 'Chỉ lib có lỗ hổng',
    summary: 'Không có lỗ hổng đã biết | {n} thư viện có lỗ hổng | {n} thư viện có lỗ hổng',
    count: '{n} lỗ hổng | {n} lỗ hổng',
    clean: 'Chưa thấy',
    fixedIn: 'đã vá ở {v}',
    noFix: 'chưa có bản vá',
    show: 'Xem lỗ hổng của {name}',
    openAdvisory: 'Mở cảnh báo {id} trên osv.dev',
    noSummary: 'Không có tóm tắt (chưa tải được bản ghi)',
    severity: { critical: 'Nghiêm trọng', high: 'Cao', moderate: 'Trung bình', low: 'Thấp', unknown: 'Chưa xếp mức' },
    loading: 'Đang hỏi osv.dev…',
    error: {
      invalid: 'Có tên hoặc phiên bản thư viện không gửi tới osv.dev được.',
      'too-many': 'Quá nhiều thư viện cho một lần kiểm lỗ hổng (tối đa 300).',
      unavailable: 'Kiểm lỗ hổng cần app desktop.',
      network: 'Không kết nối được osv.dev. Bảng bản mới phía trên vẫn dùng được; có mạng thì bấm Bảo mật lại.',
      timeout: 'osv.dev không trả lời kịp. Hãy bấm Bảo mật lại.',
      'bad-response': 'osv.dev trả về dữ liệu không đọc được. Hãy thử lại sau.',
    },
    note: 'Bảo mật chỉ hỏi osv.dev khi chủ nhân bấm, chỉ gửi tên và phiên bản thư viện; kết quả giữ 1 giờ.',
  },
}

export default { en, vi }
