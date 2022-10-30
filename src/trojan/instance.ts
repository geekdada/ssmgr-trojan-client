import execa from 'execa'
import os from 'os'
import { join } from 'path'
import tcpPortUsed from 'tcp-port-used'

import { trojanLogger } from '../logger'

const ensureTrojanPort = async (host: string, port: number) => {
  await tcpPortUsed.waitUntilUsedOnHost(port, host, 1000, 10000)
}

export const startTrojan = (
  trojanHost: string,
  trojanPort: number,
  configPath: string,
) => {
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
        .forEach((log: string) => {
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
          }
        })
    })
  }

  ensureTrojanPort(trojanHost, trojanPort)
    .then(() => {
      trojanProcess.emit('api-service-ready', {})
    })
    .catch(() => {
      throw new Error('trojan-go API service is not ready after timeout.')
    })

  return trojanProcess
}
