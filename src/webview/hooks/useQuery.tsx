import { useEffect, useState } from 'react'
import { useBoolean, useDebounce, useLocalStorage } from 'react-use'
import { SearchQuery, UIQuery } from '../../types'
import { childPort } from '../postMessage'
export { SearchQuery }
// this is the single sole point of communication
// between search query and search result
import { postSearch } from './useSearch'

import { postScanRule } from './useSearch'

const searchQuery: Record<keyof UIQuery, any> = {
  pattern: '',
  strictness: 'smart',
  selector: '',
  includeFile: '',
  rewrite: '',
  lang: '',
  isRule: false,
  ruleId: '',
}

type PatternKeys = 'selector'

const LS_KEYS: Record<Exclude<keyof UIQuery, PatternKeys | 'isRule' | 'ruleId'>, string> = {
  pattern: 'ast-grep-search-panel-input-value',
  includeFile: 'ast-grep-search-panel-include-value',
  rewrite: 'ast-grep-search-panel-rewrite-value',
  strictness: 'ast-grep-search-panel-strictness-value',
  lang: 'ast-grep-search-panel-lang-value',
}

export function refreshResult(isNewTab = false) {
  if (searchQuery.isRule && searchQuery.ruleId) {
    postScanRule(searchQuery.ruleId, searchQuery.includeFile, isNewTab)
  } else {
    postSearch(searchQuery, isNewTab)
  }
}
childPort.onMessage('refreshAllSearch', () => refreshResult())
childPort.onMessage('clearSearchResults', () => {
  searchQuery.pattern = ''
  refreshResult()
})

export function useRuleConfig() {
  const [isRule, setIsRule] = useState(searchQuery.isRule)
  const [ruleId, setRuleId] = useState(searchQuery.ruleId)
  useEffect(() => {
    searchQuery.isRule = isRule
  }, [isRule])
  useEffect(() => {
    searchQuery.ruleId = ruleId
  }, [ruleId])
  return { isRule, setIsRule, ruleId, setRuleId }
}

export function useSearchField(key: keyof typeof LS_KEYS) {
  const [field = '', setField] = useLocalStorage(LS_KEYS[key], '')
  // this useEffect and useDebounce is silly
  useEffect(() => {
    searchQuery[key] = field
  }, [field, key])
  // this is really BAD code :(
  useEffect(() => {
    if (key !== 'pattern') {
      return
    }
    childPort.onMessage('searchByCode', ({ text }) => {
      searchQuery[key] = field
      setField(text)
      refreshResult()
    })
  }, [key, field, setField])
  useDebounce(refreshResult, 150, [field])
  return [field, setField] as const
}

export function usePatternConfig(key: PatternKeys) {
  const [field, setField] = useState(searchQuery[key])
  // this useEffect and useDebounce is silly
  useEffect(() => {
    searchQuery[key] = field
  }, [field, key])
  useDebounce(refreshResult, 150, [field])
  return [field, setField] as const
}

export function useSearchOption() {
  const [includeFile = '', setIncludeFile] = useSearchField('includeFile')
  const [showOptions, toggleOptions] = useBoolean(Boolean(includeFile))

  useEffect(() => {
    childPort.onMessage('setIncludeFile', val => {
      setIncludeFile(val.includeFile)
      toggleOptions(true)
    })
  }, [toggleOptions, setIncludeFile])
  return {
    includeFile,
    setIncludeFile,
    showOptions,
    toggleOptions,
  }
}

export function hasInitialRewrite() {
  return Boolean(localStorage.getItem(LS_KEYS.rewrite))
}
