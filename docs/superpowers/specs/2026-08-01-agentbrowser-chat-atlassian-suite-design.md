# AgentBrowser chat Atlassian suite — design

**Date:** 2026-08-01  
**Status:** Approved (Approach 2 — full chat suite)  
**Scope:** Chat-driven Jira/Confluence API actions + Confluence result report (summary + attachment)

## Goals

From AgentBrowser chat, using Settings credentials (separate Jira/Confluence):

- Create Jira issues  
- Search Jira issues  
- Comment on issues  
- Transition issue status  
- Create Confluence pages  
- Post **result report** to Confluence: short summary page + attach `report.html` (or generate HTML)

## Chat intents

| Kind | Examples |
|------|----------|
| `jira_create` | log this to Jira: … / create a Jira bug |
| `jira_search` | search Jira for … / find my open issues |
| `jira_comment` | comment on PROJ-123: … |
| `jira_transition` | set PROJ-123 to Done / transition PROJ-123 to In Progress |
| `confluence_create` | create a Confluence page |
| `confluence_report` | post result report to Confluence |

## Result report (C)

1. Summary HTML (task, status, steps, URL, errors, recent chat)  
2. Create Confluence page  
3. Attach workspace `report.html` or generated session HTML  
4. Reply with page URL + attachment note  

## Non-goals

- Browser UI automation of Jira/Confluence  
- Settings credential redesign  

## Primary files

- `backend/app/atlassian.py` — search, comment, transitions, attach  
- `backend/app/integration_actions.py` — intent router  
- `backend/tests/test_integration_kind.py` (+ new helpers tests)  
- `frontend/src/followUpPrompts.ts` — suggestions  
