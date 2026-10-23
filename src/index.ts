import {BrowserSession} from './browser/BrowserSession.ts'

export {BrowserSession} from './browser/BrowserSession.ts'
export {launchDetached} from './browser/launchDetached.ts'
export type {DetachedInfo} from './browser/launchDetached.ts'
export {launchUnmanaged} from './browser/launchUnmanaged.ts'
export type {UnmanagedInfo, UnmanagedLaunchOptions} from './browser/launchUnmanaged.ts'
export {normalizeUrl} from './browser/options.ts'
export type {LaunchOptions} from './browser/options.ts'
export {resolveExecutable} from './browser/resolveExecutable.ts'

export const launchBrowser = (options?: import('./browser/options.ts').LaunchOptions) => BrowserSession.launch(options)
export default launchBrowser

export {resolveTraceCategories, standardTraceCategories, tracePresets} from './trace/categories.ts'
export type {TracePreset} from './trace/categories.ts'
export {recordBrowserTrace} from './trace/recordBrowserTrace.ts'
export {TraceRecorder} from './trace/TraceRecorder.ts'
export type {TraceOptions} from './trace/TraceRecorder.ts'
