const en = {
  peerWs: {
    someone: 'another session',
    sessions: '{n} session | {n} sessions',
    openMonitor: 'Show {name} in Monitor',
    chipLabel: '{text}. {action}',
    projectNews: 'Message in another project: {text}',
    short: {
      out: '→ {name}',
      in: '← {name}',
      both: '⇄ {name}',
      opened: '↳ {name}',
    },
  },
}

const vi: typeof en = {
  peerWs: {
    someone: 'một phiên khác',
    sessions: '{n} phiên',
    openMonitor: 'Xem {name} trong Monitor',
    chipLabel: '{text}. {action}',
    projectNews: 'Có tin ở project khác: {text}',
    short: {
      out: '→ {name}',
      in: '← {name}',
      both: '⇄ {name}',
      opened: '↳ {name}',
    },
  },
}

export default { en, vi }
