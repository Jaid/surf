import {endpoint} from './config.js'

// Clicking an item sends its action, mirroring Enter and Ctrl+C in the terminal.
const menus = {
  trace: {
    id: 'surf-trace',
    action: 'enter',
    title: 'Stop trace',
  },
  end: {
    id: 'surf-end',
    action: 'end',
    title: 'End session',
  },
}
const queue = []
let socket
let keepalive
let state = {
  trace: {visible: false},
  end: {visible: false},
}

const apply = () => {
  for (const [key, menu] of Object.entries(menus)) {
    chrome.contextMenus.update(menu.id, state[key], () => void chrome.runtime.lastError)
  }
}

const connect = () => {
  if (socket) {
    return
  }
  socket = new WebSocket(endpoint)
  socket.addEventListener('open', () => {
    for (const message of queue.splice(0)) {
      socket.send(message)
    }
    // Exchanging messages keeps the service worker, and thus the socket, alive.
    keepalive = setInterval(() => socket.send('keepalive'), 20_000)
  })
  socket.addEventListener('message', event => {
    state = JSON.parse(event.data)
    apply()
  })
  socket.addEventListener('close', () => {
    clearInterval(keepalive)
    socket = undefined
    setTimeout(connect, 1000)
  })
}

const send = message => {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(message)
    return
  }
  queue.push(message)
  connect()
}

chrome.contextMenus.removeAll(() => {
  for (const [key, menu] of Object.entries(menus)) {
    chrome.contextMenus.create({
      id: menu.id,
      title: menu.title,
      contexts: ['all'],
      ...state[key],
    }, apply)
  }
})
chrome.contextMenus.onClicked.addListener(info => {
  const menu = Object.values(menus).find(({id}) => id === info.menuItemId)
  if (menu) {
    send(menu.action)
  }
})
connect()
