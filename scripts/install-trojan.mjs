/* global argv, path, fs, $ */

import 'zx/globals'
import os from 'node:os'
import { pipeline } from 'node:stream'
import { promisify } from 'node:util'
import * as unzipper from 'unzipper'

const streamPipeline = promisify(pipeline)
const version = argv._[1] || process.env.INSTALL_TROJAN_VERSION || 'latest'
const tmpFolder = path.join(os.tmpdir(), 'ssmgr-trojan-client')
const targetFile = path.join(tmpFolder, 'trojan-go')
const osPlatform = os.platform().toLowerCase()
const osArch = os.arch().toLowerCase()

if (fs.existsSync(targetFile)) {
  await fs.remove(targetFile)
}

if (!['x64', 'arm64'].includes(osArch)) {
  throw new Error(`Unsupported architecture: ${osArch}`)
}
if (!['linux', 'darwin'].includes(osPlatform)) {
  throw new Error(`Unsupported platform: ${osPlatform}`)
}
if (!fs.existsSync(tmpFolder)) {
  fs.mkdirSync(tmpFolder)
}

let url

switch (osPlatform) {
  case 'linux':
    {
      const linuxArch = osArch === 'x64' ? 'amd64' : 'armv8'

      url = `https://github.com/p4gefau1t/trojan-go/releases/${
        version === 'latest' ? 'latest/download' : 'download/' + version
      }/trojan-go-linux-${linuxArch}.zip`
    }
    break
  case 'darwin':
    {
      const darwinArch = osArch === 'x64' ? 'amd64' : 'arm64'

      url = `https://github.com/p4gefau1t/trojan-go/releases/${
        version === 'latest' ? 'latest/download' : 'download/' + version
      }/trojan-go-darwin-${darwinArch}.zip`
    }
    break
}

console.info('> tmpFolder:', tmpFolder)
console.info('> Download trojan-go from', url)

const response = await fetch(url)

if (!response.ok) throw new Error(`unexpected response ${response.statusText}`)

await streamPipeline(response.body, unzipper.Extract({ path: tmpFolder }))

console.info('> Download is successful:', tmpFolder)

await fs.move(targetFile, path.join(__dirname, '../bin/trojan-go'))
await $`chmod +x ${path.join(__dirname, '../bin/trojan-go')}`

console.info(
  '> Trojan is successfully installed to:',
  path.join(__dirname, '../bin/trojan-go'),
)
