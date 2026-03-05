import spawn, { type Subprocess } from 'nano-spawn'
import path from 'node:path'
import { commands, FileType, type ExtensionContext, Uri, window, workspace } from 'vscode'

import type { DisplayResult, PatternQuery, ProjectRule, SearchQuery, SgSearch, YAMLConfig } from '../types'
import { parentPort, resolveBinary, streamedPromise } from './common'

/**
 * Set up search query handling and search commands
 */
export function activateSearch(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand('ast-grep.searchInFolder', findInFolder),
    commands.registerCommand('ast-grep.searchByCode', searchByCode),
  )
}

// biome-ignore lint/suspicious/noExplicitAny: todo
function findInFolder(data: any) {
  const workspacePath = workspace.workspaceFolders?.[0]?.uri?.fsPath
  // compute relative path to the workspace folder
  const relative = workspacePath && path.relative(workspacePath, data.fsPath)
  if (!relative) {
    window.showErrorMessage('ast-grep Error: folder is not in the workspace')
    return
  }
  commands.executeCommand('ast-grep.search.input.focus')
  parentPort.postMessage('setIncludeFile', {
    includeFile: relative,
  })
}

const LEADING_SPACES_RE = /^\s*/
const PRE_CTX = 30
const POST_CTX = 100

export function splitByHighLightToken(search: SgSearch): DisplayResult {
  const { start, end } = search.range
  let startIdx = start.column
  let endIdx = end.column
  let displayLine = search.lines
  // multiline matches! only display the first line!
  if (start.line < end.line) {
    displayLine = search.lines.split(/\r?\n/, 1)[0]
    endIdx = displayLine.length
  }
  // strip leading spaces
  const leadingSpaces = displayLine.match(LEADING_SPACES_RE)?.[0].length
  if (leadingSpaces) {
    displayLine = displayLine.substring(leadingSpaces)
    startIdx -= leadingSpaces
    endIdx -= leadingSpaces
  }
  // TODO: improve this rendering logic
  // truncate long lines
  if (startIdx > PRE_CTX + 3) {
    displayLine = '...' + displayLine.substring(startIdx - PRE_CTX)
    const length = endIdx - startIdx
    startIdx = PRE_CTX + 3
    endIdx = startIdx + length
  }
  if (endIdx + POST_CTX + 3 < displayLine.length) {
    displayLine = displayLine.substring(0, endIdx + POST_CTX) + '...'
  }
  return {
    startIdx,
    endIdx,
    displayLine,
    lineSpan: end.line - start.line,
    file: search.file,
    range: search.range,
    language: search.language,
    ...handleReplacement(search.replacement),
  }
}

function handleReplacement(replacement?: string) {
  if (replacement) {
    return { replacement }
  }
  return {}
}

type StreamingHandler = (r: SgSearch[]) => void
let child: Subprocess | undefined

async function uniqueCommand(
  proc: Subprocess | undefined,
  handler: StreamingHandler,
) {
  // kill previous search
  if (child) {
    const childProc = await child.nodeChildProcess
    childProc.kill('SIGTERM')
  }
  if (!proc) {
    return Promise.resolve()
  }
  try {
    // set current proc to child
    child = proc
    await streamedPromise(proc, handler)
    // unset child only when the promise succeed
    // interrupted proc will be replaced by latter proc
    child = undefined
  } catch (e) {
    console.info('search aborted: ', e)
  }
}

// TODO: add unit test for commandBuilder
export function buildCommand(query: SearchQuery) {
  if ('yaml' in query) {
    return buildYAMLCommand(query)
  } else {
    return buildPatternCommand(query)
  }
}

function buildPatternCommand(query: PatternQuery) {
  const { pattern, includeFile, strictness } = query
  if (!pattern) {
    return
  }
  const command = resolveBinary()
  const uris = workspace.workspaceFolders?.map(i => i.uri?.fsPath) ?? []
  const args = ['run', '--pattern', pattern, '--json=stream']
  if (query.selector) {
    args.push('--selector', query.selector)
  }
  if (query.rewrite) {
    args.push('--rewrite', query.rewrite)
  }
  if (strictness && strictness !== 'smart') {
    args.push('--strictness', strictness)
  }
  if (query.lang) {
    args.push('--lang', query.lang)
  }
  const validIncludeFile = includeFile.split(',').filter(Boolean)
  const hasGlobPattern = validIncludeFile.some(i => i.includes('*'))
  if (hasGlobPattern) {
    args.push(...validIncludeFile.map(i => `--globs=${i}`))
  } else {
    args.push(...validIncludeFile)
  }
  console.debug('running', query, command, args)
  // TODO: multi-workspaces support
  return spawn(command, args, {
    cwd: uris[0],
  })
}

interface Handlers {
  onData: StreamingHandler
  onError: (e: Error) => void
}

async function getPatternRes(query: SearchQuery, handlers: Handlers) {
  const proc = buildCommand(query)
  if (proc) {
    const childProc = await proc.nodeChildProcess
    childProc.on('error', (error: Error) => {
      console.debug('ast-grep CLI runs error')
      handlers.onError(error)
    })
  }
  return uniqueCommand(proc, handlers.onData)
}

function buildYAMLCommand(config: YAMLConfig) {
  const { yaml, includeFile } = config
  if (!yaml) {
    return
  }
  const command = resolveBinary()
  const uris = workspace.workspaceFolders?.map(i => i.uri?.fsPath) ?? []
  const args = ['scan', '--inline-rules', yaml, '--json=stream']
  const validIncludeFile = includeFile.split(',').filter(Boolean)
  const hasGlobPattern = validIncludeFile.some(i => i.includes('*'))
  if (hasGlobPattern) {
    args.push(...validIncludeFile.map(i => `--globs=${i}`))
  } else {
    args.push(...validIncludeFile)
  }
  console.debug('scanning', config, command, args)
  // TODO: multi-workspaces support
  return spawn(command, args, {
    cwd: uris[0],
  })
}

async function getYAMLRes(config: YAMLConfig, handlers: Handlers) {
  const proc = buildYAMLCommand(config)
  if (proc) {
    const childProc = await proc.nodeChildProcess
    childProc.on('error', (error: Error) => {
      console.debug('ast-grep CLI runs error')
      handlers.onError(error)
    })
  }
  return uniqueCommand(proc, handlers.onData)
}

parentPort.onMessage('search', async payload => {
  const onData = (ret: SgSearch[]) => {
    parentPort.postMessage('searchResultStreaming', {
      ...payload,
      searchResult: ret.map(splitByHighLightToken),
    })
  }
  await getPatternRes(payload, {
    onData,
    onError(error) {
      parentPort.postMessage('error', {
        error,
        ...payload,
      })
    },
  })
  parentPort.postMessage('searchEnd', payload)
})

parentPort.onMessage('searchInNewTab', async payload => {
  try {
    let proc
    if ('ruleId' in payload) {
      proc = buildProjectRuleCommand(payload.ruleId, payload.includeFile)
    } else if ('yaml' in payload) {
      proc = buildYAMLCommand(payload as YAMLConfig)
    } else {
      proc = buildPatternCommand(payload as PatternQuery)
    }

    if (!proc) {
      return
    }

    const results: SgSearch[] = []

    const onData = (ret: SgSearch[]) => {
      results.push(...ret)
    }

    // Do not use uniqueCommand so we don't kill ongoing searches in the sidebar
    await streamedPromise(proc, onData)

    if (results.length === 0) {
      window.showInformationMessage('ast-grep: No results found.')
      return
    }

    const document = await workspace.openTextDocument({
      content: JSON.stringify(results, null, 2),
      language: 'json'
    })
    await window.showTextDocument(document, { preview: false })
  } catch (e) {
    console.error('searchInNewTab error:', e)
    window.showErrorMessage(`ast-grep failed to search in new tab: ${e}`)
  }
})

parentPort.onMessage('yaml', async payload => {
  const onData = (ret: SgSearch[]) => {
    parentPort.postMessage('searchResultStreaming', {
      ...payload,
      searchResult: ret.map(splitByHighLightToken),
    })
  }
  await getYAMLRes(payload, {
    onData,
    onError(error) {
      parentPort.postMessage('error', {
        error,
        ...payload,
      })
    },
  })
  parentPort.postMessage('searchEnd', payload)
})

function searchByCode() {
  const editor = window.activeTextEditor
  if (!editor) {
    return
  }
  const selection = editor.selection
  const text = editor.document.getText(selection)
  commands.executeCommand('ast-grep.search.input.focus')
  parentPort.postMessage('searchByCode', { text })
}

// Parse the `ruleDirs` list from sgconfig.yml/yaml content
function parseRuleDirs(content: string): string[] {
  const dirs: string[] = []
  const lines = content.split('\n')
  let inRuleDirs = false
  for (const line of lines) {
    if (/^ruleDirs\s*:/.test(line)) {
      inRuleDirs = true
      continue
    }
    if (inRuleDirs) {
      const match = line.match(/^\s+-\s+(.+)/)
      if (match) {
        dirs.push(match[1].trim())
      } else if (/^[a-zA-Z]/.test(line)) {
        break // new top-level YAML key: end of ruleDirs section
      }
    }
  }
  return dirs
}

// Extract the `id` field from a rule YAML file's content
function extractRuleId(content: string): string | undefined {
  const match = content.match(/^id:\s*(.+?)(?:\s*#.*)?$/m)
  return match?.[1].trim()
}

/**
 * Read project rules from sgconfig.yml and its ruleDirs.
 */
export async function readProjectRules(): Promise<ProjectRule[]> {
  const workspaceFolders = workspace.workspaceFolders
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return []
  }

  const root = workspaceFolders[0].uri
  const configRelPath = workspace.getConfiguration('astGrep').get('configPath', '') || ''

  // Try to read the config file
  let configContent: string | undefined
  const candidates = configRelPath ? [configRelPath] : ['sgconfig.yml', 'sgconfig.yaml']
  for (const candidate of candidates) {
    try {
      const bytes = await workspace.fs.readFile(Uri.joinPath(root, candidate))
      configContent = new TextDecoder().decode(bytes)
      break
    } catch {
      // try next candidate
    }
  }

  if (!configContent) {
    return []
  }

  const ruleDirs = parseRuleDirs(configContent)
  if (ruleDirs.length === 0) {
    return []
  }

  const rules: ProjectRule[] = []
  for (let dir of ruleDirs) {
    // Convert posix-style paths from sgconfig into proper OS paths if necessary
    dir = dir.replace(/[\\/]+/g, path.sep)
    let dirUri: Uri
    if (path.isAbsolute(dir)) {
      dirUri = Uri.file(dir)
    } else {
      dirUri = Uri.joinPath(root, dir)
    }

    try {
      const entries = await workspace.fs.readDirectory(dirUri)
      for (const [name, type] of entries) {
        if (type === FileType.File && (name.endsWith('.yml') || name.endsWith('.yaml'))) {
          try {
            const fileUri = Uri.joinPath(dirUri, name)
            const bytes = await workspace.fs.readFile(fileUri)
            const id = extractRuleId(new TextDecoder().decode(bytes))
            if (id) {
              rules.push({ id })
            }
          } catch {
            // skip unreadable files
          }
        }
      }
    } catch {
      // skip unreadable directories
    }
  }

  return rules.sort((a, b) => a.id.localeCompare(b.id))
}

function buildProjectRuleCommand(ruleId: string, includeFile: string) {
  if (!ruleId) {
    return
  }
  const command = resolveBinary()
  const uris = workspace.workspaceFolders?.map(i => i.uri?.fsPath) ?? []
  const args = ['scan', '--json=stream', '--filter', ruleId]
  const validIncludeFile = includeFile.split(',').filter(Boolean)
  const hasGlobPattern = validIncludeFile.some(i => i.includes('*'))
  if (hasGlobPattern) {
    args.push(...validIncludeFile.map(i => `--globs=${i}`))
  } else {
    args.push(...validIncludeFile)
  }
  console.debug('scanning rule', ruleId, command, args)
  // TODO: multi-workspaces support
  return spawn(command, args, {
    cwd: uris[0],
  })
}

parentPort.onMessage('getProjectRules', async () => {
  const rules = await readProjectRules()
  parentPort.postMessage('loadProjectRules', { rules })
})

async function getScanRuleRes(
  ruleId: string,
  includeFile: string,
  handlers: Handlers,
) {
  const proc = buildProjectRuleCommand(ruleId, includeFile)
  if (proc) {
    const childProc = await proc.nodeChildProcess
    childProc.on('error', (error: Error) => {
      console.debug('ast-grep CLI runs error')
      handlers.onError(error)
    })
  }
  return uniqueCommand(proc, handlers.onData)
}

parentPort.onMessage('scanRule', async payload => {
  const onData = (ret: SgSearch[]) => {
    parentPort.postMessage('searchResultStreaming', {
      ...payload,
      searchResult: ret.map(splitByHighLightToken),
    })
  }
  await getScanRuleRes(payload.ruleId, payload.includeFile, {
    onData,
    onError(error) {
      parentPort.postMessage('error', {
        error,
        ...payload,
      })
    },
  })
  parentPort.postMessage('searchEnd', payload)
})
