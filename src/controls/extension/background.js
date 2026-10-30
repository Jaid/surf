import {endpoint} from './config.js'

const menuId = 'surf-trace'
const queue = []
let socket
let keepalive
let state = {
  title: 'Stop trace',
  visible: false,
}

const apply = () => {
  chrome.contextMenus.update(menuId, state, () => void chrome.runtime.lastError)
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
  chrome.contextMenus.create({
    id: menuId,
    contexts: ['all'],
    ...state,
  }, apply)
})
chrome.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId === menuId) {
    send('enter')
  }
})
connect()
