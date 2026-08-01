import { describe, expect, it } from 'vitest'
import { buildHtmlDocument } from './messageExport'
import {
  QA_TABLE_HEADERS,
  actualResultFromEvidence,
  agentPriority,
  buildAgentObservations,
  buildAgentQaRows,
  buildQaExcelCsv,
  formatTcId,
  renderQaTableHtml,
} from './qaReport'

describe('qaReport', () => {
  it('headers', () => {
    expect([...QA_TABLE_HEADERS]).toEqual([
      'TC ID',
      'Feature',
      'Test Scenario',
      'Preconditions',
      'Test Steps',
      'Expected Result',
      'Actual Result',
      'Priority',
    ])
  })

  it('formatTcId', () => {
    expect(formatTcId('AB', 1)).toBe('AB-TC-001')
  })

  it('priority', () => {
    expect(agentPriority(true)).toBe('High')
    expect(agentPriority(false)).toBe('Medium')
  })

  it('actual result', () => {
    expect(actualResultFromEvidence({ executed: false })).toBe('Not executed')
    expect(actualResultFromEvidence({ executed: true, error: 'timeout' })).toBe('Fail — timeout')
    expect(actualResultFromEvidence({ executed: true, detail: 'clicked submit' })).toBe(
      'Pass — clicked submit',
    )
    expect(actualResultFromEvidence({ executed: true })).toBe('N/A')
  })

  it('builds rows from steps with actions', () => {
    const rows = buildAgentQaRows(
      [
        {
          step: 1,
          url: 'https://app.example/login',
          thought: 'Open login',
          actions: ['Navigate — https://app.example/login', 'Click — #submit'],
          details: [],
        },
      ],
      { startUrl: 'https://app.example/', taskTheme: 'Login flow' },
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]['TC ID']).toBe('AB-TC-001')
    expect(rows[0].Feature).toMatch(/app\.example|Login/)
    expect(rows[0]['Test Steps']).toMatch(/Navigate|Click/)
    expect(rows[0]['Expected Result']).toBe('As specified in prompt')
    expect(rows[0].Priority).toBe('Medium')
  })

  it('skips steps with no actions and no screenshot', () => {
    const rows = buildAgentQaRows([{ step: 1, actions: [], details: [], thought: 'thinking only' }])
    expect(rows).toHaveLength(0)
  })

  it('render table includes headers', () => {
    const html = renderQaTableHtml([
      {
        'TC ID': 'AB-TC-001',
        Feature: 'x',
        'Test Scenario': 'y',
        Preconditions: 'N/A',
        'Test Steps': 'click',
        'Expected Result': 'As specified in prompt',
        'Actual Result': 'Pass — ok',
        Priority: 'Medium',
      },
    ])
    expect(html).toContain('TC ID')
    expect(html).toContain('AB-TC-001')
    expect(html).toContain('qa-table')
    expect(html).toContain('colgroup')
  })

  it('excel csv has header row and BOM', () => {
    const csv = buildQaExcelCsv([
      {
        'TC ID': 'AB-TC-001',
        Feature: 'app.example',
        'Test Scenario': 'Login',
        Preconditions: 'N/A',
        'Test Steps': 'Click, Type',
        'Expected Result': 'As specified in prompt',
        'Actual Result': 'Pass — ok',
        Priority: 'Medium',
      },
    ])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('TC ID,Feature,Test Scenario')
    expect(csv).toContain('AB-TC-001')
  })

  it('observations on error', () => {
    const { observations, recommendations } = buildAgentObservations([
      {
        step: 2,
        actions: ['Click — #x'],
        details: ['error: not found'],
        thought: 'Click button',
      },
    ])
    expect(observations.length).toBeGreaterThan(0)
    expect(recommendations.length).toBeGreaterThan(0)
  })

  it('buildHtmlDocument uses QA sections', () => {
    const html = buildHtmlDocument('## Done\nAll good', {
      title: 't',
      username: 'u',
      prompt: 'p',
      timestamp: 'now',
      steps: [
        {
          step: 1,
          url: 'https://example.com',
          actions: ['Click — #a'],
          details: [],
          thought: 'Click A',
        },
      ],
    })
    expect(html).toContain('Executive Summary')
    expect(html).toContain('Observations & Recommendations')
    expect(html).toContain('AB-TC-001')
    expect(html).not.toContain('<h2>Summary</h2>')
  })
})
