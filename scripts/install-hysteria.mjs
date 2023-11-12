/* global argv, path, fs, $ */

import 'zx/globals'
import os from 'node:os'
import { pipeline } from 'node:stream'
import { promisify } from 'node:util'

const streamPipeline = promisify(pipeline)
const version = argv._[1] || process.env.INSTALL_HYSTERIA_VERSION || 'latest'
const tmpFolder = path.join(os.tmpdir(), 'ssmgr-trojan-client')
const tmpBinPath = path.join(tmpFolder, 'hysteria')
const binPath = path.join(__dirname, '../bin/hysteria')
const osPlatform = os.platform().toLowerCase()
const osArch = os.arch().toLowerCase()

if (!['x64', 'arm64'].includes(osArch)) {
  throw new Error(`Unsupported architecture: ${osArch}`)
}
if (!['linux', 'darwin'].includes(osPlatform)) {
  throw new Error(`Unsupported platform: ${osPlatform}`)
}

if (fs.existsSync(tmpBinPath)) {
  await fs.remove(tmpBinPath)
}
if (fs.existsSync(binPath)) {
  await fs.remove(binPath)
}
if (!fs.existsSync(tmpFolder)) {
  fs.mkdirSync(tmpFolder)
}
if (version !== 'latest' && !version.startsWith('v')) {
  throw new Error('version must be "latest" or start with "v"')
}

function getArch() {
  switch (osPlatform) {
    case 'linux':
      return osArch === 'x64' ? 'amd64' : 'arm64'
    case 'darwin':
      return osArch === 'x64' ? 'amd64' : 'arm64'
  }
}

async function getLatestVersion() {
  const resp = await fetch(
    `https://api.hy2.io/v1/update?cver=installscript&plat=${osPlatform}&arch=${getArch()}&chan=release&side=server`,
  )
  const json = await resp.json()

  return json.lver
}

async function getDownloadUrl() {
  const downloadVersion =
    version === 'latest' ? await getLatestVersion() : version

  return `https://github.com/apernet/hysteria/releases/download/app/${downloadVersion}/hysteria-${osPlatform}-${getArch()}`
}

const url = await getDownloadUrl()

console.info('> tmpFolder:', tmpFolder)
console.info('> Download hysteria from', url)

const response = await fetch(url)

if (!response.ok) throw new Error(`unexpected response ${response.statusText}`)

const writeStream = fs.createWriteStream(tmpBinPath)

await streamPipeline(response.body, writeStream)
await fs.move(tmpBinPath, binPath)
await $`chmod +x ${binPath}`
await $`${binPath} version`

console.info('> Hysteria is successfully installed to:', binPath)
