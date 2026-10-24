import {dirname, resolve} from 'forward-slash-path'
import fs from 'fs-extra'

export const perfettoVersion = 'v58.2'
const traceconvBuilds: Partial<Record<string, {
  file: string
  sha256: string
}>> = {
  'linux-amd64': {
    file: 'traceconv',
    sha256: 'aede4607ec9ca997aad8a558fa5443b593dcd58673f792308e96702f9fe3548c',
  },
  'linux-arm64': {
    file: 'traceconv',
    sha256: '9d8d262e98b3a6db8e7c4924514cff6c73449885c6fd30fd9f939d89bee2142f',
  },
  'mac-amd64': {
    file: 'traceconv',
    sha256: '5c749815665e2ac11ec46855e73212dc78d2230de155a035b0b729b856285d4c',
  },
  'mac-arm64': {
    file: 'traceconv',
    sha256: '7d10aaa173ccdf286a3eef050a50e0a6722c38f92fa177479b77155e96058f5b',
  },
  'windows-amd64': {
    file: 'traceconv.exe',
    sha256: '252ff7c9c9051081a09d0525fdae04571de527b62420c7fac34d432ba2686e71',
  },
}
const getPerfettoPlatform = () => {
  const system = ({
    darwin: 'mac',
    linux: 'linux',
    win32: 'windows',
  } as Record<string, string | undefined>)[process.platform]
  const architecture = ({
    arm64: 'arm64',
    x64: 'amd64',
  } as Record<string, string | undefined>)[process.arch]
  return `${system}-${architecture}`
}
export const ensureTraceconv = async (cacheRoot: string) => {
  const platform = getPerfettoPlatform()
  const build = traceconvBuilds[platform]
  if (!build) {
    throw new Error(`No pinned traceconv build for ${platform}.`)
  }
  const executable = resolve(cacheRoot, perfettoVersion, platform, build.file)
  if (await Bun.file(executable).exists() && Bun.CryptoHasher.hash('sha256', await Bun.file(executable).arrayBuffer(), 'hex') === build.sha256) {
    return executable
  }
  const url = `https://commondatastorage.googleapis.com/perfetto-luci-artifacts/${perfettoVersion}/${platform}/${build.file}`
  console.error(`Downloading traceconv ${perfettoVersion} from ${url}`)
  const response = await fetch(url, {signal: AbortSignal.timeout(60_000)})
  if (!response.ok) {
    throw new Error(`traceconv download returned HTTP ${response.status}.`)
  }
  const data = new Uint8Array(await response.arrayBuffer())
  const sha256 = Bun.CryptoHasher.hash('sha256', data, 'hex')
  if (sha256 !== build.sha256) {
    throw new Error(`traceconv checksum mismatch: expected ${build.sha256}, got ${sha256}.`)
  }
  await fs.mkdir(dirname(executable), {recursive: true})
  const temporary = `${executable}.${crypto.randomUUID()}.partial`
  try {
    await Bun.write(temporary, data)
    await fs.chmod(temporary, 0o755)
    await fs.rename(temporary, executable)
  } finally {
    await fs.rm(temporary, {force: true})
  }
  return executable
}
export const convertProtoTraceToJson = async (traceconv: string, input: string, output: string) => {
  const subprocess = Bun.spawn([traceconv, 'json', input, output], {
    stdout: 'ignore',
    stderr: 'pipe',
    windowsHide: true,
  })
  const stderr = new Response(subprocess.stderr)
  const [exitCode, stderrText] = await Promise.all([subprocess.exited, stderr.text()])
  if (exitCode !== 0) {
    throw new Error(`traceconv exited with code ${exitCode}: ${stderrText.trim()}`)
  }
}
