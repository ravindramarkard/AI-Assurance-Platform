import { describe, expect, it } from 'vitest'
import { buildHtmlDocument } from './messageExport'
import {
  EXECUTION_TABLE_HEADERS,
  QA_TABLE_HEADERS,
  actualResultFromEvidence,
  agentPriority,
  buildAgentObservations,
  buildAgentQaRows,
  buildCriticalIssues,
  buildExecutionRows,
  buildQaExcelCsv,
  buildReportExecutionRows,
  formatTcId,
  parsePlannedTestCases,
  renderExecutionTableHtml,
  renderEvidenceHtml,
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

  it('execution headers match Test Execution Report', () => {
    expect([...EXECUTION_TABLE_HEADERS]).toEqual([
      'TC ID',
      'Test Scenario',
      'Status',
      'Duration',
      'Evidence / Notes',
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
  })

  it('builds execution rows with PASS/FAIL status', () => {
    const rows = buildExecutionRows([
      {
        step: 1,
        thought: 'Open login',
        actions: ['Navigate — https://app.example/login'],
        details: [],
      },
      {
        step: 2,
        thought: 'Failed. missing button',
        actions: ['error: selector'],
        details: [],
        screenshotDataUrl: 'data:image/png;base64,X',
      },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0].Status).toBe('PASS')
    expect(rows[1].Status).toBe('FAIL')
    expect(rows[1]['TC ID']).toBe('AB-TC-002')
  })

  it('keeps full scenario and evidence without mid-sentence ellipsis', () => {
    const longGoal =
      'Navigate to the secure portal, dismiss the certificate warning, and complete login with the test user'
    const longErr =
      "error: net::ERR_CERT_AUTHORITY_INVALID — The browser is showing Chrome's security warning page with advanced options"
    const rows = buildExecutionRows([
      {
        step: 1,
        evidenceText: `next_goal: ${longGoal}\nevaluation_previous_goal: Failed. SSL blocked navigation to the login page`,
        thought: 'The navigation to https://example.com failed due to an SSL certificate error and the browser is stuck',
        actions: [longErr, 'Click — index=165'],
        details: [],
        url: 'https://example.com/login',
        pageTitle: 'Privacy error',
      },
    ])
    expect(rows[0]['Test Scenario']).toBe(longGoal)
    expect(rows[0]['Test Scenario']).not.toMatch(/…$/)
    const notes = rows[0]['Evidence / Notes']
    expect(notes).toMatch(/Failed|SSL/i)
    expect(notes).not.toContain('index=165')
    expect(notes).not.toMatch(/Cli index/)
    expect(notes).toMatch(/Clicked the on-page control|Attempted:/i)

    const html = renderExecutionTableHtml(rows)
    expect(html).toContain(longGoal)
    expect(html).toContain('cell-wrap')
    expect(html).not.toMatch(/The browser i…/)
  })

  it('writes plain-English evidence notes instead of raw tool dumps', () => {
    const rows = buildExecutionRows([
      {
        step: 1,
        evidenceText:
          'next_goal: Ask what is AI\nevaluation_previous_goal: Success. Answered with a correct definition of Artificial Intelligence',
        thought: 'Answered the question',
        actions: ["Click — index=12", "Type — text='What is AI?'"],
        details: [],
        pageTitle: 'Chat',
      },
    ])
    const notes = rows[0]['Evidence / Notes']
    expect(notes).toMatch(/Artificial Intelligence|correct definition/i)
    expect(notes).not.toContain('index=')
    expect(notes).not.toContain("text='What is AI?'")
  })

  it('redacts secret tags in evidence', () => {
    const rows = buildExecutionRows([
      {
        step: 1,
        thought: 'Type username',
        actions: ["Type — text='<secret>x_app_user</secret>'"],
        details: [],
      },
    ])
    expect(rows[0]['Evidence / Notes']).toMatch(/Entered credentials|Entered text/i)
    expect(rows[0]['Evidence / Notes']).not.toContain('x_app_user')
    expect(rows[0]['Evidence / Notes']).not.toContain('<secret>')
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
  })

  it('render execution table', () => {
    const html = renderExecutionTableHtml([
      {
        'TC ID': 'AB-TC-001',
        'Test Scenario': 'Login',
        Status: 'PASS',
        Duration: '12s',
        'Evidence / Notes': 'ok',
        failed: false,
      },
    ])
    expect(html).toContain('Evidence / Notes')
    expect(html).toContain('Duration')
    expect(html).toContain('12s')
    expect(html).toContain('PASS')
    expect(html).not.toContain('☐')
  })

  it('computes per-step duration from timestamps', () => {
    const rows = buildExecutionRows([
      {
        step: 1,
        thought: 'Open',
        actions: ['Navigate — https://a.example'],
        details: [],
        createdAt: '2026-08-06T10:00:00.000Z',
      },
      {
        step: 2,
        thought: 'Click',
        actions: ['Click — submit'],
        details: [],
        createdAt: '2026-08-06T10:00:15.000Z',
      },
    ])
    expect(rows[0].Duration).toBe('—')
    expect(rows[1].Duration).toBe('15s')
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
  })

  it('builds critical issues from failed rows', () => {
    const rows = buildExecutionRows([
      {
        step: 1,
        thought: 'Open login',
        actions: ['Navigate — https://app.example/login'],
        details: [],
      },
      {
        step: 2,
        thought: 'Failed. missing button',
        actions: ['error: selector not found'],
        details: [],
      },
    ])
    const issues = buildCriticalIssues(rows)
    expect(issues).toHaveLength(1)
    expect(issues[0].tcId).toBe('AB-TC-002')
    expect(issues[0].severity).toBe('High')
    expect(issues[0].error).toMatch(/selector/)
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

  it('buildHtmlDocument matches Test Execution Report look', () => {
    const html = buildHtmlDocument('## Done\nAll good', {
      title: 'ignored session title',
      username: 'Automated QA',
      prompt: 'Test login',
      timestamp: '2024',
      screenshotArchive: 'on_failure',
      steps: [
        {
          step: 1,
          url: 'https://app.example/login',
          thought: 'Failed. button missing',
          actions: ['error: selector'],
          details: [],
          evidenceText: 'evaluation_previous_goal: Failed. button missing',
          screenshotDataUrl: 'data:image/png;base64,FAILSHOT',
          createdAt: '2026-08-06T10:00:00.000Z',
        },
        {
          step: 2,
          url: 'https://app.example/login',
          thought: 'Retry',
          actions: ['Click — submit'],
          details: [],
          createdAt: '2026-08-06T10:01:00.000Z',
        },
      ],
    })
    expect(html).toContain('AI Assistant Test Execution Report')
    expect(html).toContain('<th scope="row">Project</th><td>AI Assistant</td>')
    expect(html).toContain('Document Information')
    expect(html).toContain('<th scope="row">Duration</th>')
    expect(html).toContain('1m')
    expect(html).toContain('Duration</th>')
    expect(html).toContain('#006633')
    expect(html).toContain('Field')
    expect(html).toContain('Value')
    expect(html).toContain('Report Date')
    expect(html).toContain('Tester')
    expect(html).toContain('Blocked / Not Tested')
    expect(html).toContain('Partial / N/A')
    expect(html).toContain('Evidence / Notes')
    expect(html).toContain('FAIL')
    expect(html).toContain('Section Result:')
    expect(html).toContain('Critical Issues Found')
    expect(html).toContain('Recommendations')
    expect(html).toContain('Conclusion')
    expect(html).toContain('Overall Assessment')
    expect(html).toContain('End of Report')
    expect(html).toContain('FAILSHOT')
    expect(html).not.toContain('ignored session title')
    expect(html).not.toContain('Functional Self-Test')
    expect(html).not.toContain('☐')
  })

  it('strips pasted HTML from executive summary', () => {
    const messy = [
      'Done.',
      'Attachments:',
      'test_report.html:',
      '<!DOCTYPE html><html><head><style>body{margin:0}</style></head><body><h1>x</h1></body></html>',
    ].join('\n')
    const html = buildHtmlDocument(messy, { title: 't', timestamp: 'now', steps: [] })
    expect(html).not.toContain('body{margin:0}')
    expect(html).toContain('Embedded HTML report source omitted')
  })

  it('parses user-pasted GEN/VIS plan and uses those TC IDs in the report', () => {
    const plan = [
      '# 1. General Questions',
      '',
      '| TC ID | Feature | Test Scenario | Preconditions | Test Steps | Expected Result | Priority |',
      '|--------|----------|---------------|---------------|------------|-----------------|----------|',
      '| GEN-001 | General Questions | Ask a simple factual question | User logged in | Ask "What is AI?" | Correct answer displayed | High |',
      '',
      '# 3. Visualization',
      '',
      '| TC ID | Feature | Test Scenario | Preconditions | Test Steps | Expected Result | Priority |',
      '|--------|----------|---------------|---------------|------------|-----------------|----------|',
      '| VIS-001 | Bar Chart | Generate bar chart | Dataset uploaded | Request chart | Chart generated | High |',
    ].join('\n')

    const parsed = parsePlannedTestCases(plan)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]['TC ID']).toBe('GEN-001')
    expect(parsed[0].section).toContain('General Questions')
    expect(parsed[1]['TC ID']).toBe('VIS-001')

    const { rows, fromPlan } = buildReportExecutionRows(
      [
        {
          step: 1,
          thought: 'Ask What is AI?',
          actions: ['Type — What is AI?'],
          details: [],
          evidenceText: 'evaluation_previous_goal: Success. Answered What is AI correctly',
          createdAt: '2026-08-06T10:00:00.000Z',
        },
      ],
      { planText: plan },
    )
    expect(fromPlan).toBe(true)
    expect(rows.map((r) => r['TC ID'])).toEqual(['GEN-001', 'VIS-001'])
    expect(rows[0].Status).toBe('PASS')
    expect(rows[1].Status).toBe('BLOCKED')
    expect(rows[1]['Evidence / Notes']).toMatch(/Not executed/i)

    const html = buildHtmlDocument('Done', {
      prompt: plan,
      steps: [
        {
          step: 1,
          thought: 'Ask What is AI?',
          actions: ['Type — What is AI?'],
          details: [],
          evidenceText: 'next_goal: Ask what is AI\nevaluation_previous_goal: Success. Correct answer',
        },
      ],
    })
    expect(html).toContain('GEN-001')
    expect(html).toContain('VIS-001')
    expect(html).toContain('General Questions')
    expect(html).toContain('Visualization')
    expect(html).not.toContain('AB-TC-001')
  })

  it('evidence respects archive never', () => {
    const html = renderEvidenceHtml(
      [
        {
          step: 1,
          actions: ['error: x'],
          details: [],
          thought: 'Failed.',
          screenshotDataUrl: 'data:image/png;base64,X',
        },
      ],
      'never',
    )
    expect(html).not.toContain('data:image')
    expect(html).toContain('Never')
  })
})
