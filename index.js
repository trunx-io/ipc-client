var ipc = require('node-ipc')
var uuid = require('uuid');

// Init
async function init() {
  const socketName = 'trunxio1';
  connectSocket(socketName, () => {
    console.log('Connected!')
  })
}

// init()

// State
const replyHandlers = new Map()
const listeners = new Map()
let messageQueue = []
let socketClient = null

// Functions
function ipcConnect(opts, func) {
  ipc.config.silent = opts.silent || true;
  ipc.config.maxRetries = opts.maxRetries !== undefined ? opts.maxRetries : 3;
  ipc.connectTo(opts.id, () => {
    func(ipc.of[opts.id])
  })
}

async function isSocketListening(name) {
  return new Promise((resolve, reject) => {
    ipcConnect({id: name, maxRetries: 1}, function(client) {
      client.on('connect', () => {ipc.disconnect(name);resolve(true)})
      client.on('destroy', () => resolve(false))
    })
  })
}

function connectSocket(name, onOpen, opts={}) {
  opts.id = name;
  return ipcConnect(opts, function(client) {
    client.on('message', data => {
      const msg = JSON.parse(data)

      if (msg.type === 'error') {
        // Up to you whether or not to care about the error
        const { id } = msg
        replyHandlers.delete(id)
      } else if (msg.type === 'reply') {
        const { id, result } = msg

        const handler = replyHandlers.get(id)
        if (handler) {
          replyHandlers.delete(id)
          handler.resolve(result)
        }
      } else if (msg.type === 'push') {
        const { name, args } = msg

        const listens = listeners.get(name)
        if (listens) {
          listens.forEach(listener => {
            listener(args)
          })
        }
      } else {
        throw new Error('Unknown message type: ' + JSON.stringify(msg))
      }
    })

    client.on('connect', () => {
      socketClient = client

      // Send any messages that were queued while closed
      if (messageQueue.length > 0) {
        messageQueue.forEach(msg => client.emit('message', msg))
        messageQueue = []
      }

      onOpen(socketClient)
    })

    client.on('disconnect', () => {
      socketClient = null
    })
  })
}

function send(name, args) {
  return new Promise((resolve, reject) => {
    let id = uuid.v4()
    replyHandlers.set(id, { resolve, reject })
    if (socketClient) {
      socketClient.emit('message', JSON.stringify({ id, name, args }))
    } else {
      messageQueue.push(JSON.stringify({ id, name, args }))
    }
  })
}

function connectAndSend(id, method, args) {
  return new Promise(async (resolve, reject) => {
    var res = await isSocketListening(id);

    if ( res ) {
      connectSocket(id, (socket) => {
        send(method, args)
        .then((data) => {
          ipc.disconnect(socket.id);
          if( typeof data === "string") resolve({error:data});
          else resolve({data});
        }).catch( (error) => {
          // console.log("error",error)
          resolve({error}) })
      }, {maxRetries: 10})
    } else {
      resolve({error: `socket (${id}) is not listening`});
    }
  })
}

function listen(name, cb) {
  if (!listeners.get(name)) {
    listeners.set(name, [])
  }
  listeners.get(name).push(cb)

  return () => {
    let arr = listeners.get(name)
    listeners.set(name, arr.filter(cb_ => cb_ !== cb))
  }
}

function unlisten(name) {
  listeners.set(name, [])
}

module.exports = { ipc, send, connectSocket, isSocketListening, connectAndSend }
