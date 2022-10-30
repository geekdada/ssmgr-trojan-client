import execa from 'execa'
import os from 'os'
import { join } from 'path'

import { trojanLogger } from '../logger'

export const startTrojan = (configPath: string) => {
  const osPlatform = os.platform().toLowerCase()

  const osArch = os.arch().toLowerCase()
  if (!['x64', 'arm64'].includes(osArch)) {
    throw new Error(`Unsupported architecture: ${osArch}`)
  }
  if (!['linux', 'darwin'].includes(osPlatform)) {
    throw new Error(`Unsupported platform: ${osPlatform}`)
  }

  const bin = join(__dirname, '../../bin/trojan-go')

  const trojanProcess = execa(bin, ['--config', configPath], {
    all: true,
  })

  if (trojanProcess.all) {
    trojanProcess.all.on('data', (data: Buffer) => {
      data
        .toString()
        .split(os.EOL)
        .forEach((line: string) => {
          const log = line.trim()

          if (log.length > 0) {
            if (log.includes('[FATAL]') || log.includes('[ERROR]')) {
              trojanLogger.error(log.replace(/\[FATAL\]|\[ERROR\]/g, '').trim())
            } else if (log.includes('[WARN]')) {
              trojanLogger.warn(log.replace('[WARN]', '').trim())
            } else if (log.includes('[INFO]')) {
              trojanLogger.info(log.replace('[INFO]', '').trim())
            } else if (log.includes('[DEBUG]')) {
              trojanLogger.debug(log.replace('[DEBUG]', '').trim())
            } else {
              trojanLogger.debug(log.trim())
            }

            if (log.includes('initializing')) {
              setTimeout(() => {
                trojanProcess.emit('api-service-ready', {})
              }, 500)
            }
          }
        })
    })
  }

  return trojanProcess
}
