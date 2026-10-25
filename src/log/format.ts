import type {Protocol} from 'puppeteer-core'

export const logText = (value: string) => value.replaceAll(/[\u{0}-\u{8}\u{B}-\u{1F}\u{7F}-\u{9F}]/gu, character => String.raw`\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`)

export const remoteText = (value: Protocol.Runtime.RemoteObject): string => {
  if (value.unserializableValue !== undefined) {
    return value.unserializableValue
  }
  if (value.value !== undefined) {
    return typeof value.value === 'string' ? value.value : JSON.stringify(value.value)
  }
  if (value.preview && value.subtype !== 'error') {
    const properties = value.preview.properties.map(property => `${property.name}: ${property.value ?? property.type}`)
    if (value.preview.overflow) {
      properties.push('…')
    }
    return `${value.description ?? value.className ?? 'Object'} { ${properties.join(', ')} }`
  }
  return value.description ?? value.type
}
