import { getLogger, configure, Configuration } from 'log4js'
import { join } from 'path'

import { isProd } from '../utils'

const getLog4jsConfig = () => {
  const logPath = join(process.cwd(), 'logs')

  const log4jsConfig: Configuration = isProd
    ? {
        appenders: {
          out: { type: 'stdout' },
          app: {
            type: 'dateFile',
            keepFileExt: true,
            filename: join(logPath, 'application.log'),
            layout: { type: 'basic' },
          },
          trojan: {
            type: 'dateFile',
            keepFileExt: true,
            filename: join(logPath, 'trojan.log'),
            layout: { type: 'basic' },
          },
        },
        categories: {
          default: { appenders: ['app'], level: 'trace' },
          app: { appenders: ['app'], level: 'trace' },
          trojan: { appenders: ['trojan'], level: 'trace' },
        },
      }
    : {
        appenders: {
          out: { type: 'stdout', layout: { type: 'colored' } },
          app: {
            type: 'dateFile',
            keepFileExt: true,
            filename: join(logPath, 'application.log'),
            layout: { type: 'basic' },
          },
          trojan: {
            type: 'dateFile',
            keepFileExt: true,
            filename: join(logPath, 'trojan.log'),
            layout: { type: 'basic' },
          },
        },
        categories: {
          default: { appenders: ['out'], level: 'trace' },
          app: { appenders: ['app', 'out'], level: 'trace' },
          trojan: { appenders: ['trojan', 'out'], level: 'trace' },
        },
      }

  return log4jsConfig
}

configure(getLog4jsConfig())

const logger = getLogger('app')
const trojanLogger = getLogger('trojan')

logger.level = isProd ? process.env.LOG_LEVEL || 'warn' : 'trace'
trojanLogger.level = isProd ? process.env.TROJAN_LOG_LEVEL || 'warn' : 'trace'

export { logger, trojanLogger }

export const enableDebug = () => {
  logger.level = 'debug'
  trojanLogger.level = 'debug'
}
