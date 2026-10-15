// Merged into `workspace` of en.ts / vi.ts (v48 pane drag); `keys` items are merged into `keys.item`.
const en = {
  workspace: {
    drag: {
      grip: 'Drag to move this pane',
      paneHint: 'Drag the header onto another pane to dock it there. Hold {key} to swap.',
      tabHint: 'Drag onto a pane to put this tab beside it',
      dock: 'Dock {edge}',
      swap: 'Swap',
      newTab: 'Drop for its own tab',
      edge: { left: 'left', right: 'right', top: 'above', bottom: 'below' },
      moved: 'Pane moved {edge}',
      swapped: 'Panes swapped',
      merged: 'Tab docked {edge}',
      detached: 'Pane moved to its own tab',
    },
  },
  keys: {
    wsSwap: 'Swap the pane with the one beside it',
  },
}

const vi = {
  workspace: {
    drag: {
      grip: 'Kéo để di chuyển pane này',
      paneHint: 'Kéo thanh tiêu đề thả lên pane khác để ghép vào cạnh đó. Giữ {key} để đổi chỗ.',
      tabHint: 'Kéo thả lên một pane để đặt tab này cạnh nó',
      dock: 'Ghép {edge}',
      swap: 'Đổi chỗ',
      newTab: 'Thả để tách ra tab riêng',
      edge: { left: 'bên trái', right: 'bên phải', top: 'phía trên', bottom: 'phía dưới' },
      moved: 'Đã chuyển pane sang {edge}',
      swapped: 'Đã đổi chỗ hai pane',
      merged: 'Đã ghép tab vào {edge}',
      detached: 'Đã tách pane ra tab riêng',
    },
  },
  keys: {
    wsSwap: 'Đổi chỗ pane với pane bên cạnh',
  },
}

export default { en, vi }
