import { describe, expect, it } from 'vitest'
import { suggestFollowUps } from './followUpPrompts'
import type { Event, Message, Session } from './api'

function baseSession(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    title: 'QA run',
    task: 'Run test cases',
    status: 'completed',
    step_count: 3,
    ...over,
  } as Session
}

describe('suggestFollowUps', () => {
  it('does not suggest FX tips for Convert to Arabic / translation tasks', () => {
    const messages: Message[] = [
      {
        id: 'm1',
        role: 'user',
        content: 'Convert the English document to Arabic and verify the PDF filename',
        created_at: '2026-08-06T10:00:00Z',
      } as Message,
      {
        id: 'm2',
        role: 'assistant',
        content: 'Translation completed. Filename in Arabic: FAIL',
        created_at: '2026-08-06T10:01:00Z',
      } as Message,
    ]
    const tips = suggestFollowUps({
      session: baseSession(),
      messages,
      events: [] as Event[],
    })
    expect(tips.join(' ')).not.toMatch(/price|exchange|1000 units|rate on the page/i)
  })

  it('suggests report actions for TC ID test plans', () => {
    const plan = [
      '# 1. General Questions',
      '| TC ID | Feature | Test Scenario | Preconditions | Test Steps | Expected Result | Priority |',
      '| GEN-001 | General | Ask What is AI? | logged in | Ask | Correct answer | High |',
    ].join('\n')
    const tips = suggestFollowUps({
      session: baseSession({ task: plan }),
      messages: [
        { id: 'u', role: 'user', content: plan, created_at: 't' } as Message,
        {
          id: 'a',
          role: 'assistant',
          content: 'GEN-001 PASS. Evidence: answered correctly.',
          created_at: 't2',
        } as Message,
      ],
      events: [] as Event[],
    })
    expect(tips.some((t) => /Test Execution Report|failed|Evidence/i.test(t))).toBe(true)
    expect(tips.join(' ')).not.toMatch(/AED|INR|1000 units|latest price/i)
  })

  it('still suggests FX tips for real exchange-rate asks', () => {
    const tips = suggestFollowUps({
      session: baseSession({ task: 'Get AED to INR exchange rate' }),
      messages: [
        {
          id: 'u',
          role: 'user',
          content: 'Get the latest AED to INR exchange rate',
          created_at: 't',
        } as Message,
        {
          id: 'a',
          role: 'assistant',
          content: 'AED/INR is 22.5',
          created_at: 't2',
        } as Message,
      ],
      events: [] as Event[],
    })
    expect(tips.join(' ')).toMatch(/price|Convert 1000|rate/i)
  })
})
