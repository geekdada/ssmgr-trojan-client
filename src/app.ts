import { ExecaChildProcess } from 'execa'
import { Socket, createServer } from 'net'
import onDeath from 'death'

import { pack, checkCode } from './socket'
import { logger } from './logger'
import { DBClient, initDB } from './db-client/db'
import { parseConfig, Config } from './config'
import Sentry from './sentry'
import { startTrojan } from './trojan'
import {
  ReceiveData,
  ECommand,
  UserFlow,
  UserIdPwd,
  ParsedResult,
  CommandMessage,
} from './types'
import { assertNever } from './utils'
import { version } from './version'
import { DBClientResult } from './db-client/types'

let config: Config
let dbClient: DBClient
let trojanProcess: ExecaChildProcess | null = null

/**
 * @param data command message buffer
 *
 * Supported commands:
 *  list ()
 *    List current users and encoded passwords
 *    return type:
 *      { type: 'list', data: [{ id: <number>, password: password<string> }, ...] }
 *  add (acctId<number>, password<string>)
 *    Attention: Based on trojan protocol, passwords must be unique.
 *    Passwords are stored in redis in SHA224 encoding (Don't pass encoded passwords).
 *    Use this method if you want to change password.
 *    return type:
 *      { type: 'add', id: acctId<number> }
 *  del (acctId<number>)
 *    Deletes an account by the given account ID
 *    return type:
 *      { type: 'del', id: acctId<number> }
 *  flow ()
 *    Returns flow data of all accounts since last flow query (including ones having no flow).
 *    It also lets you check active accounts. (In case redis has been wiped)
 *    return type:
 *      { type: 'flow', data: [{ id: <number>, flow: flow<number> }, ...] }
 *  version ()
 *    Returns the version of this client.
 *    return type:
 *      { type: 'version', version: version<string> }
 */
const receiveCommand = async (
  data: CommandMessage,
): Promise<DBClientResult> => {
  interface MergedCommandMessage {
    command: ECommand
    port: number
    password: string
    options?: {
      clear?: boolean
    }
    [key: string]: any
  }

  const message: MergedCommandMessage = {
    command: ECommand.Version,
    port: 0,
    password: '',
    ...data,
  }
  logger.info('Message received: ' + JSON.stringify(message))

  switch (message.command) {
    case ECommand.List:
      return dbClient.listAccounts()
    case ECommand.Add:
      return dbClient.addAccount(message.port, message.password)
    case ECommand.Delete:
      return dbClient.removeAccount(message.port)
    case ECommand.Flow:
      return dbClient.getFlow(message.options)
    case ECommand.Version:
      return { type: ECommand.Version, version: version }
    default:
      return assertNever(message.command)
  }
}

const parseResult = (result: DBClientResult): ParsedResult => {
  switch (result.type) {
    case ECommand.List:
      return result.data.map(
        (user): UserIdPwd => ({
          port: user.id,
          password: user.password,
        }),
      )
    case ECommand.Add:
      return { port: result.id }
    case ECommand.Delete:
      return { port: result.id }
    case ECommand.Flow:
      return result.data.map(
        (user): UserFlow => ({
          port: user.id,
          sumFlow: user.flow,
        }),
      )
    case ECommand.Version:
      return { version: result.version }
    default:
      throw new Error('Invalid command')
  }
}

const checkData = async (receive: ReceiveData): Promise<void> => {
  const buffer = receive.data
  let length = 0
  let data: Buffer
  let code: Buffer

  if (buffer.length < 2) {
    return
  }

  length = buffer[0] * 256 + buffer[1]

  if (buffer.length >= length + 2) {
    data = buffer.slice(2, length - 2)
    code = buffer.slice(length - 2)

    if (!checkCode(config.key, data, code)) {
      receive.socket.end(pack({ code: 2 }))
      return
    }

    try {
      const payload = JSON.parse(data.slice(6).toString()) as CommandMessage
      const rawResult = await receiveCommand(payload).catch((err: Error) => {
        Sentry.captureException(err, (scope) => {
          scope.setTags({
            phase: 'receiveCommand',
          })
          return scope
        })
        if (payload.command) {
          throw new Error(`Query error on '${payload.command}': ${err.message}`)
        } else {
          throw new Error(`Query error: ${err.message}`)
        }
      })
      const result = parseResult(rawResult)

      logger.debug('Result: ' + JSON.stringify(result, null, 2))

      receive.socket.end(pack({ code: 0, data: result }))
    } catch (err) {
      if (err instanceof Error) {
        logger.error(err.message)

        receive.socket.end(
          pack({ code: err.message === 'Invalid command' ? 1 : -1 }),
        )
      }
    }
  }
}

const server = createServer((socket: Socket) => {
  const receive: ReceiveData = {
    data: Buffer.from(''),
    socket,
  }

  socket.on('data', (data: Buffer) => {
    receive.data = Buffer.concat([receive.data, data])

    checkData(receive).catch((err: Error) => {
      Sentry.captureException(err, (scope) => {
        scope.setTags({
          phase: 'checkData',
        })
        return scope
      })
      logger.error(err.message)
    })
  })

  socket.on('error', (err: Error) => {
    Sentry.captureException(err, (scope) => {
      scope.setTags({
        phase: 'socket:error',
      })
      return scope
    })
    logger.error('Socket error: ', err.message)
  })
}).on('error', (err: Error) => {
  Sentry.captureException(err, (scope) => {
    scope.setTags({
      phase: 'server:error',
    })
    return scope
  })
  logger.error('TCP server error: ', err.message)
})

const startServer = async (): Promise<void> => {
  logger.info(`Running ssmgr-trojan-client v${version}`)

  config = parseConfig()

  if (config.debug) {
    logger.level = 'debug'
  }

  logger.debug(JSON.stringify(config))

  if (config.trojanConfig) {
    trojanProcess = startTrojan(config.trojanConfig)

    trojanProcess.on('exit', (code) => {
      if (code === 1) {
        logger.error(`trojan-go process exited with code ${code}`)
        dbClient.disconnect()
        server.close()

        process.exit(1)
      }
    })
  }

  dbClient = await initDB(config)

  server.listen(config.port, config.addr, () => {
    logger.info(`Listening on ${config.addr}:${config.port}`)
  })
}

startServer().catch((e) => {
  if (e instanceof Error) {
    logger.error(e.message)
    Sentry.captureException(e, (scope) => {
      scope.setTags({
        phase: 'startServer',
      })
      return scope
    })
  } else {
    logger.error(e)
  }
  logger.error('FATAL ERROR. TERMINATED.')
  process.exit(1)
})

onDeath({ debug: true, uncaughtException: false })((signal) => {
  logger.info(`Received ${signal}. Terminating the service...`)
  if (trojanProcess) {
    trojanProcess.kill(0)
  }
  dbClient.disconnect()
  server.close()
})
