const en = {
  officeV63: {
    style: {
      label: 'Office style',
      hint: 'Pixel art or the soft 3D diorama',
      pixel: 'Pixel',
      iso: '3D (beta)',
      missing: '3D art is not installed yet, the office shows simple shapes',
    },
    switching: {
      iso: 'Loading the 3D office…',
      pixel: 'Loading the pixel office…',
    },
    switchFailed: {
      iso: 'Could not load the 3D office, back to pixel',
      pixel: 'Could not load the pixel office, back to 3D',
    },
  },
}

const vi: typeof en = {
  officeV63: {
    style: {
      label: 'Kiểu văn phòng',
      hint: 'Pixel art hoặc mô hình 3D mềm',
      pixel: 'Pixel',
      iso: '3D (beta)',
      missing: 'Chưa có bộ hình 3D, văn phòng đang vẽ khối đơn giản',
    },
    switching: {
      iso: 'Đang tải văn phòng 3D…',
      pixel: 'Đang tải văn phòng pixel…',
    },
    switchFailed: {
      iso: 'Không tải được văn phòng 3D, quay lại pixel',
      pixel: 'Không tải được văn phòng pixel, quay lại 3D',
    },
  },
}

export default { en, vi }
