const lifecycle = new AbortController();
export const disposeRequests = () => lifecycle.abort();
async function api(path, options) {
  const response = await fetch(path, {...options, signal: AbortSignal.any([lifecycle.signal,options?.signal ?? AbortSignal.timeout(35000)])});
  let data;
  try { data = await response.json(); }
  catch { throw new Error('The local service returned an unreadable response. Check the server and retry.'); }
  if (!response.ok) throw new Error(data.error || 'The request failed.');
  return data;
}

export const loadTests = () => api('/api/dm/tests');
export const loadCatalog = () => api('/api/dm/catalog');
export const loadTest = id => api(`/api/dm/tests/${encodeURIComponent(id)}`);
const update = (id, suffix, method, value) => api(`/api/dm/tests/${encodeURIComponent(id)}/${suffix}`, {
  method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(value),
});
export const saveProfile = (id, revision, profile) => update(id, 'profile', 'PUT', {revision, profile});
export const saveIssue = (id, issue) => update(id, 'issues', 'POST', issue);
export const setIssueStatus = (id, issueId, status) => update(id, `issues/${encodeURIComponent(issueId)}`, 'PATCH', {status});

export function saveTest(file, details, requestId) {
  const headers = {'Content-Type': 'text/csv', 'X-DM-Request': requestId};
  for (const [name, value] of Object.entries({...details, Source: file.name})) {
    headers[`X-DM-${name}`] = encodeURIComponent(value);
  }
  return api('/api/dm/tests', {method: 'POST', body: file, headers, signal: AbortSignal.timeout(60000)});
}

export const loadExperiments = () => api('/api/dm/experiments');
export const loadExperiment = id => api(`/api/dm/experiments/${encodeURIComponent(id)}`);
const post = (path, value) => api(path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(value)});
export const submitExperiment = (request_id, spec) => post('/api/dm/experiments', {request_id,spec});
export const cancelExperiment = id => post(`/api/dm/experiments/${encodeURIComponent(id)}/cancel`, {});
export const associateRoute = (id, selection) => post(`/api/dm/tests/${encodeURIComponent(id)}/route-associations`, selection);
export const compareRoutes = value => post('/api/dm/comparisons', value);
