import * as stylex from '@stylexjs/stylex'
import { type ChangeEvent, useCallback, useState } from 'react'
import { VscBook } from 'react-icons/vsc'
import { useEffectOnce } from 'react-use'
import type { ProjectRule } from '../../../types'
import { useSearchField } from '../../hooks/useQuery'
import { postScanRule } from '../../hooks/useSearch'
import { childPort } from '../../postMessage'

const styles = stylex.create({
  ruleButton: {
    position: 'absolute',
    height: '20px',
    width: '20px',
    border: '1px solid transparent',
    // Positioned to the left of LangSelect (right: 2, width: 20) with a 4px gap
    right: 26,
    top: 3,
    borderRadius: '3px',
    ':hover': {
      backgroundColor: 'var(--vscode-inputOption-hoverBackground)',
    },
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  ruleActive: {
    borderColor: 'var(--vscode-inputOption-activeBorder)',
    ':hover': {
      background: 'none',
      filter: 'drop-shadow(1px 1px 3px rgba(0,0,0,0.2))',
    },
  },
  ruleDropdown: {
    height: '100%',
    width: '100%',
    border: 'none',
    background: 'transparent',
    position: 'absolute',
    inset: 0,
    appearance: 'none',
    outline: 'none',
    color: 'transparent',
    cursor: 'pointer',
    ':focus': {
      outline: 'none',
    },
  },
  ruleOptions: {
    color: 'var(--vscode-dropdown-foreground)',
    backgroundColor: 'var(--vscode-dropdown-background)',
  },
})

export function RuleSelect() {
  const [rules, setRules] = useState<ProjectRule[]>([])
  const [selectedRule, setSelectedRule] = useState('')
  const [includeFile] = useSearchField('includeFile')

  useEffectOnce(() => {
    childPort.postMessage('getProjectRules', {})
    childPort.onMessage('loadProjectRules', ({ rules: incoming }) => {
      setRules(incoming)
    })
  })

  const onChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const ruleId = e.target.value
      setSelectedRule(ruleId)
      if (ruleId) {
        postScanRule(ruleId, includeFile)
      }
    },
    [includeFile],
  )

  if (rules.length === 0) {
    return null
  }

  return (
    <label
      {...stylex.props(styles.ruleButton, selectedRule ? styles.ruleActive : null)}
      title={selectedRule ? `Run rule: ${selectedRule}` : 'Run a project rule'}
    >
      <select
        {...stylex.props(styles.ruleDropdown)}
        value={selectedRule}
        onChange={onChange}
      >
        <option value="" {...stylex.props(styles.ruleOptions)}>
          Select Project Rule
        </option>
        {rules.map(r => (
          <option key={r.id} value={r.id} {...stylex.props(styles.ruleOptions)}>
            {r.id}
          </option>
        ))}
      </select>
      <VscBook />
    </label>
  )
}
