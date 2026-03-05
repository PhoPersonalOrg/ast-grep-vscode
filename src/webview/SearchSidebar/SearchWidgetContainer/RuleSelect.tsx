import * as stylex from '@stylexjs/stylex'
import { type ChangeEvent, useCallback, useState } from 'react'
import { VscBook } from 'react-icons/vsc'
import { useEffectOnce } from 'react-use'
import type { ProjectRule } from '../../../types'
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

import { useRuleConfig } from '../../hooks/useQuery'

export function RuleSelect() {
  const [rules, setRules] = useState<ProjectRule[]>([])
  const { isRule, setIsRule, ruleId, setRuleId } = useRuleConfig()

  useEffectOnce(() => {
    childPort.postMessage('getProjectRules', {})
    childPort.onMessage('loadProjectRules', ({ rules: incoming }) => {
      setRules(incoming)
    })
  })

  const onChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const newRuleId = e.target.value
      setRuleId(newRuleId)
      setIsRule(!!newRuleId)
    },
    [setRuleId, setIsRule],
  )

  if (rules.length === 0) {
    return null
  }

  return (
    <label
      {...stylex.props(styles.ruleButton, isRule ? styles.ruleActive : null)}
      title={isRule ? `Selected rule: ${ruleId}` : 'Select a project rule'}
    >
      <select
        {...stylex.props(styles.ruleDropdown)}
        value={ruleId}
        onChange={onChange}
      >
        <option value="" {...stylex.props(styles.ruleOptions)}>
          No Project Rule
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
